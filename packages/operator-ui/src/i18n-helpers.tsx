import * as React from "react";
import { IntlContext, type IntlShape, type MessageDescriptor } from "react-intl";
import { getSharedIntl } from "./i18n/messages.js";
import { formatDateTime } from "./utils/format-date-time.js";

type MessageValues = Record<string, string | number | Date | null | undefined>;
type TranslatableMessage = string | MessageDescriptor;

function isMessageDescriptor(value: TranslatableMessage): value is MessageDescriptor {
  return typeof value === "object" && value !== null;
}

export function translateString(
  intl: IntlShape,
  message: TranslatableMessage,
  values?: MessageValues,
): string {
  if (isMessageDescriptor(message)) {
    return intl.formatMessage(message, values);
  }

  const defaultMessage = message;
  const catalog = intl.messages as Record<string, unknown> | undefined;
  const hasCatalogEntry =
    catalog !== undefined &&
    catalog !== null &&
    Object.prototype.hasOwnProperty.call(catalog, defaultMessage);
  if (!hasCatalogEntry && (!values || Object.keys(values).length === 0)) {
    return defaultMessage;
  }

  return intl.formatMessage(
    {
      id: defaultMessage,
      defaultMessage,
    },
    values,
  );
}

export function formatDateTimeString(
  intl: IntlShape,
  value: string | number | Date | null | undefined,
  fallback?: TranslatableMessage,
): string {
  if (value === null || value === undefined || value === "") {
    return fallback ? translateString(intl, fallback) : "";
  }
  return formatDateTime(value, undefined, intl.locale);
}

export function translateStringAttribute(
  intl: IntlShape,
  value: TranslatableMessage | null | undefined,
): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return translateString(intl, value);
}

export function translateNode(intl: IntlShape, node: React.ReactNode): React.ReactNode {
  if (typeof node === "string") {
    return translateString(intl, node);
  }
  if (Array.isArray(node)) {
    return node.map((item, index) => {
      const translated = translateNode(intl, item);
      if (React.isValidElement(translated) && translated.key === null) {
        return React.cloneElement(translated, { key: index });
      }
      return translated;
    });
  }
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    if (props.children === undefined) {
      return node;
    }
    return React.cloneElement(node, undefined, translateNode(intl, props.children));
  }
  return node;
}

export function useTranslateNode(): (node: React.ReactNode) => React.ReactNode {
  const intl = useI18n();
  return React.useCallback((node: React.ReactNode) => translateNode(intl, node), [intl]);
}

export function useI18n(): IntlShape {
  return React.useContext(IntlContext) ?? getSharedIntl();
}
