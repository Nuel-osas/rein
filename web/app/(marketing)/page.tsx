import {LandingPage} from "@/components/marketing/LandingPage";

// The shell, the tokens, the header and the footer come from
// `(marketing)/layout.tsx`. This file is only what is on this page.
//
// Product examples are explicitly labeled. Client islands handle the flat
// header's scroll state and pausable artwork; FAQ disclosures remain native HTML.
export default function MarketingPage() {
  return <LandingPage />;
}
