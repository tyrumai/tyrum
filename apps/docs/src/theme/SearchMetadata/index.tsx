import React, { type ReactNode } from "react";
import Head from "@docusaurus/Head";
import type { Props } from "@theme/SearchMetadata";

export default function SearchMetadata({ locale, version, tag }: Props): ReactNode {
  return (
    <Head>
      {locale && <meta name="docusaurus_locale" content={locale} />}
      {version && <meta name="docusaurus_version" content={version} />}
      {tag && <meta name="docusaurus_tag" content={tag} />}
    </Head>
  );
}
