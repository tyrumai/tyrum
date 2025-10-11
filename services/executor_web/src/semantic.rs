use std::{cmp::Ordering, collections::HashSet};

use playwright::api::page::Page;
use serde::Deserialize;
use strsim::jaro_winkler;

use crate::{Result, WebExecutorError};

const SIMILARITY_THRESHOLD: f64 = 0.82;
const MAX_SUGGESTIONS: usize = 5;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FieldProbe {
    tag: String,
    id: Option<String>,
    name: Option<String>,
    placeholder: Option<String>,
    aria_label: Option<String>,
    data_testid: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubmitProbe {
    tag: String,
    id: Option<String>,
    name: Option<String>,
    aria_label: Option<String>,
    data_testid: Option<String>,
    type_attr: Option<String>,
}

pub async fn suggest_field_selectors(
    page: &Page,
    original_selector: &str,
    attempted_selector: &str,
) -> Result<Vec<String>> {
    let probes: Vec<FieldProbe> = page
        .evaluate(
            "(() => {
                return Array.from(document.querySelectorAll('input, textarea, select')).map((element) => ({
                    tag: element.tagName.toLowerCase(),
                    id: element.id || null,
                    name: element.getAttribute('name') || null,
                    placeholder: element.getAttribute('placeholder') || null,
                    ariaLabel: element.getAttribute('aria-label') || null,
                    dataTestid: element.getAttribute('data-testid') || null
                }));
            })",
            Option::<()>::None,
        )
        .await
        .map_err(WebExecutorError::from)?;

    build_suggestions(
        original_selector,
        attempted_selector,
        probes.iter().flat_map(|probe| {
            let hints = selector_hints(original_selector);
            let mut entries = Vec::new();

            if let Some(id) = probe.id.as_ref() {
                push_candidate(&mut entries, &probe.tag, "id", id, &hints, true);
            }
            if let Some(name) = probe.name.as_ref() {
                push_candidate(&mut entries, &probe.tag, "name", name, &hints, true);
            }
            if let Some(data_testid) = probe.data_testid.as_ref() {
                push_candidate(
                    &mut entries,
                    &probe.tag,
                    "data-testid",
                    data_testid,
                    &hints,
                    true,
                );
            }
            if let Some(aria_label) = probe.aria_label.as_ref() {
                push_candidate(
                    &mut entries,
                    &probe.tag,
                    "aria-label",
                    aria_label,
                    &hints,
                    true,
                );
            }
            if let Some(placeholder) = probe.placeholder.as_ref() {
                push_candidate(
                    &mut entries,
                    &probe.tag,
                    "placeholder",
                    placeholder,
                    &hints,
                    false,
                );
            }

            entries
        }),
    )
}

pub async fn suggest_submit_selectors(
    page: &Page,
    original_selector: &str,
    attempted_selector: &str,
) -> Result<Vec<String>> {
    let probes: Vec<SubmitProbe> = page
        .evaluate(
            "(() => {
                const candidates = new Set();
                const query = [
                    'button',
                    'input[type=\"submit\"]',
                    'input[type=\"button\"]',
                    '[role=\"button\"]'
                ];

                return Array.from(document.querySelectorAll(query.join(','))).map((element) => ({
                    tag: element.tagName.toLowerCase(),
                    id: element.id || null,
                    name: element.getAttribute('name') || null,
                    ariaLabel: element.getAttribute('aria-label') || null,
                    dataTestid: element.getAttribute('data-testid') || null,
                    typeAttr: element.getAttribute('type') || null
                }));
            })",
            Option::<()>::None,
        )
        .await
        .map_err(WebExecutorError::from)?;

    build_suggestions(
        original_selector,
        attempted_selector,
        probes.iter().flat_map(|probe| {
            let hints = selector_hints(original_selector);
            let mut entries = Vec::new();

            if let Some(id) = probe.id.as_ref() {
                push_candidate(&mut entries, &probe.tag, "id", id, &hints, true);
            }
            if let Some(name) = probe.name.as_ref() {
                push_candidate(&mut entries, &probe.tag, "name", name, &hints, true);
            }
            if let Some(data_testid) = probe.data_testid.as_ref() {
                push_candidate(
                    &mut entries,
                    &probe.tag,
                    "data-testid",
                    data_testid,
                    &hints,
                    true,
                );
            }
            if let Some(aria_label) = probe.aria_label.as_ref() {
                push_candidate(
                    &mut entries,
                    &probe.tag,
                    "aria-label",
                    aria_label,
                    &hints,
                    true,
                );
            }
            if probe
                .type_attr
                .as_ref()
                .is_some_and(|value| value.eq_ignore_ascii_case("submit"))
            {
                entries.push((0.99, format!("{}[type=\"submit\"]", probe.tag)));
            }

            entries
        }),
    )
}

fn build_suggestions<I>(
    original_selector: &str,
    attempted_selector: &str,
    candidates: I,
) -> Result<Vec<String>>
where
    I: IntoIterator<Item = (f64, String)>,
{
    let mut seen = HashSet::new();
    seen.insert(attempted_selector.to_string());

    let mut scored: Vec<(f64, String)> = candidates
        .into_iter()
        .filter(|(score, selector)| *score >= SIMILARITY_THRESHOLD && seen.insert(selector.clone()))
        .collect();

    scored.sort_by(|a, b| match b.0.partial_cmp(&a.0) {
        Some(order) => order,
        None => Ordering::Equal,
    });

    let mut suggestions = scored
        .into_iter()
        .map(|(_, selector)| selector)
        .take(MAX_SUGGESTIONS)
        .collect::<Vec<_>>();

    if let Some(normalized) = normalized_selector(original_selector)
        && normalized != attempted_selector
        && !suggestions.iter().any(|item| item == &normalized)
    {
        suggestions.insert(0, normalized);
    }

    Ok(suggestions)
}

fn push_candidate(
    entries: &mut Vec<(f64, String)>,
    tag: &str,
    attr: &str,
    value: &str,
    hints: &[String],
    strict: bool,
) {
    let score = similarity(value, hints);
    if score < SIMILARITY_THRESHOLD {
        return;
    }

    let literal = escape_attr_value(value);
    let strict_selector = format!("{tag}[{attr}=\"{literal}\"]");
    entries.push((score, strict_selector.clone()));

    if !strict {
        entries.push((score * 0.9, format!("{tag}[{attr}*=\"{literal}\"]")));
    }

    entries.push((score * 0.85, format!("[{attr}=\"{literal}\"]")));
}

fn similarity(candidate: &str, hints: &[String]) -> f64 {
    let normalized = normalize(candidate);
    hints
        .iter()
        .map(|hint| jaro_winkler(&normalized, hint))
        .fold(0.0, f64::max)
}

fn selector_hints(selector: &str) -> Vec<String> {
    let mut hints = selector
        .split(|c: char| !c.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(normalize)
        .collect::<Vec<_>>();
    let joined = normalize(selector);
    hints.push(joined);
    hints.sort();
    hints.dedup();
    hints
}

fn normalized_selector(selector: &str) -> Option<String> {
    let mut normalized = selector.trim().to_string();
    let cleaned = normalized
        .replace(" = ", "=")
        .replace("= ", "=")
        .replace(" =", "=");
    if cleaned.contains('\'') && !cleaned.contains('\"') {
        normalized = cleaned.replace('\'', "\"");
    } else {
        normalized = cleaned;
    }
    if normalized == selector {
        None
    } else {
        Some(normalized)
    }
}

fn normalize(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

fn escape_attr_value(value: &str) -> String {
    value.replace('"', "\\\"")
}
