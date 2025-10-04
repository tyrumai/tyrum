import React from "react";
import WaitlistCta from "./waitlist-cta";

const valueProps = [
  {
    title: "Wallet limits respected",
    copy:
      "Freeze spend ceilings once and let Tyrum enforce them with audit logs you can replay.",
  },
  {
    title: "Explainable actions",
    copy:
      "Every step is justified before and after execution so you can approve with confidence.",
  },
  {
    title: "Privacy by default",
    copy: "Data stays within your workspace boundary and redacts sensitive fields by design.",
  },
];

const trustSignals = [
  "Wallet limits",
  "Explainable actions",
  "Privacy by default",
];

export default function Home() {
  return (
    <main className="landing" aria-labelledby="hero-heading">
      <section className="hero">
        <div className="hero__content">
          <p className="hero__eyebrow">Autonomy within your limits</p>
          <h1 id="hero-heading">The end of to-do.</h1>
          <p className="hero__deck">
            No lists. Just outcomes—captured, handled, and proven.
          </p>
          <div className="hero__cta">
            <WaitlistCta />
            <a className="cta cta--secondary" href="#value-props">
              See how it works
            </a>
          </div>
          <ul className="trust-row" aria-label="Proof points">
            {trustSignals.map((label) => (
              <li className="trust-row__item" key={label}>
                <span aria-hidden="true" className="trust-row__icon" />
                <span className="trust-row__label">{label}</span>
              </li>
            ))}
          </ul>
          <p className="hero__pronunciation">Tyrum is pronounced TIE-rum.</p>
        </div>
        <div className="hero__preview" aria-hidden="true">
          <div className="preview-card">
            <span className="preview-card__status">Quietly on it</span>
            <h2 className="preview-card__title">Handle the visa renewal</h2>
            <p className="preview-card__body">
              Planner coordinating a legal concierge, calendar holds, and spend caps within policy guardrails.
            </p>
            <div className="preview-card__tasks">
              <span className="preview-pill">Policy gate ✓</span>
              <span className="preview-pill">Executor queued</span>
              <span className="preview-pill">Audit streaming</span>
            </div>
          </div>
        </div>
      </section>
      <section
        aria-labelledby="value-props-heading"
        className="value-props"
        id="value-props"
      >
        <h2 className="visually-hidden" id="value-props-heading">
          Value propositions
        </h2>
        <ul className="value-props__list">
          {valueProps.map(({ title, copy }) => (
            <li className="value-props__item" key={title}>
              <h3>{title}</h3>
              <p>{copy}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
