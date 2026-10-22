# Open issues

**Draft for review by the relevant teams before anyone acts on it.** Raised while investigating the NHI and MRP quote
differences (see [the findings](nhi-vs-mrp-conviction-findings.md)); last updated 2026-10-22.

| #   | Issue                                                   | Status      | Needs                          |
| --- | ------------------------------------------------------- | ----------- | ------------------------------ |
| 1   | NHI can no longer price the original quotes             | Unexplained | NHI investigation              |
| 2   | NHI offers buildings cover to tenants                   | Open        | Pricing and underwriting       |
| 3   | Accidental damage flag and level can disagree after MRP | Unverified  | Test, then QJS fix             |
| 4   | MRP Return to quote drops the joint holder's title      | Merged      | Re-run the comparison          |
| 5   | New business accidental damage pre-selected as "None"   | Merged      | Sign-off, re-run               |
| 6   | MRP and NHI disagree on high-risk items cover           | Escalate    | Rating team                    |
| 7   | Endorsements are formatted differently on NHI and MRP   | Merged      | Deploy, re-run                 |
| 8   | MRP quote pages opened by GUID showed NHI's pricing     | Merged      | Review PR 25411, deploy, rerun |
| 9   | MRP answers were saved to NHI                           | Merged      | Deploy                         |
| 10  | MRP shows a £1 buildings sum insured                    | Open        | QJS or quote page fix          |
| 11  | MRP drops Contents insurance for a home owner           | Open        | Investigate                    |
| 12  | playwright-diff flags rendering noise                   | Open        | playwright-diff tweak          |
| 13  | NHI's saved quote and its re-quote disagree             | Open        | NHI investigation              |

## 1. NHI can no longer price the original quotes

- **What:** since 14 Oct, NHI's `CalculateQuotePremium` returns 500 for the original MRP quote GUIDs of the two test
  policies (`87f68d27…` for `718CA449FCFC4A959D99124EDC81EA87`, `11c88e9b…` for `77D5FA3FF40441F28699E5AD6F3F0C8C`). NHI
  priced the same GUIDs on 13 Oct.
- **Effect:** the NHI quote page shows Oops for those GUIDs. playwright-diff works around it by requesting a replacement
  quote GUID, so comparisons still run, but against a new NHI quote rather than the original.
- **Unknown:** whether this affects other quotes, and what changed on 14 Oct.
- **Next step:** check NHI's logs for the 500s on those GUIDs.

## 2. NHI offers buildings cover to tenants

- **What:** for 718CA449 the customer rents from the local authority (`ownershipId` `RLA01`). Artemis returns
  `isBuildingsAllowed: false`, so the MRP quote page hides the Buildings insurance row after a re-quote. NHI still
  offers buildings cover.
- **Scale (2026-10-21 run):** every tenant, not just local-authority ones. 96 of the 107 differing pages were tenants
  with the Buildings row missing on MRP: 70 rent from a landlord (`RPL01`), 14 from a housing association (`RHA01`) and
  12 from a local authority (`RLA01`). No owner or mortgaged policy lost the row. The policies and scenarios are in
  [MRP refuses cover that NHI allows](mrp-cover-allowed-differences.md).
- **Not a QuestionSetQuote bug:** MRP's own policy quote summary (`/api/quote-summary/<policyDetailsId>/<historyId>`)
  already returns `false` on first load; the comparison only showed it after a re-quote because of issue 8.
- **Decision so far:** MRP's behaviour is kept as correct; NHI's is unconfirmed.
- **Detection:** the playwright-diff comparison has no rule hiding this; it shows as a difference. Since MRP
  replacement captures are now always re-quoted (see the README's [`TCAS for a replacement GUID`](../README.md#tcas-for-a-replacement-guid) section), it appears on every
  run for an affected policy. On 2026-10-16, 718CA449's NHI quote had `buildingsIsAllowed: true` and its MRP re-quote
  `false`, and the comparison reported 12.33% of pixels changed (the MRP page is shorter without the row).
- **Next step:** pricing and underwriting to confirm whether a local-authority tenant may buy buildings cover; if not,
  NHI needs fixing.

## 3. Accidental damage flag and level can disagree after an MRP re-quote

- **What:** the policy stores accidental damage twice for each of buildings and contents: a level (`BUILDADLEVEL_ID` /
  `CONTADLEVEL_ID`: None, Basic, Full) and a cover flag (`BUILACCIDENTAL` / `CONTACCIDENTAL`).
  - QuoteJourneyService's answer-map path (`mapper/quoteJourneyToPolicy.go`, `setQuotePage`) updates the level but never
    the flag. MRP's **Return to quote** (`POST /api/save-details` with `source=tcas`) uses this path.
  - The Policy API's override path (`service/setPolicyAddOnsAndExcesses.go`) sets both: flag false for None, true
    otherwise.
  - Policy documents read the flag, not the level (PolicyLibraryService `Hp2DocumentDataService.cs`).
- **Possible effect:** a customer who picks Basic or Full accidental damage on the MRP quote page could have the level
  saved with the flag still false, and documents that say they have no accidental damage cover. The reverse (None with
  the flag still true) is also possible.
- **Status:** found by reading the code; not reproduced.
- **Next step:** change the level on an MRP quote page, save, and compare the stored flag and level. If they disagree,
  set the flag from the level in QuoteJourneyService's answer-map path, as the Policy API overrides do.

## 4. MRP Return to quote drops the joint policy holder's title

- **What:** on 3C053A54 (2026-10-19), the MRP quote page showed the joint policy holder without their title ("Mr.").
  The NHI page showed it. The title answer (`jointNamesTitle`) was the same in every request on both sides.
- **Cause:** after `POST /api/save-details` with `source=tcas`, QuoteJourneyService rebuilds the joint holders from the
  answers. It sets only `TitleId`, not the preloaded `ListTitle`. GoPackages' mrp-and-quote mapper
  (`getJointPolicyHolders`) read the title from `ListTitle`, so the summary came back with `title: 0` and
  `titleText: ""`.
- **Fix:** merged. GoPackages PR 25321 makes the mapper read `TitleId`, and QuoteJourneyService PR 25318 picks it up
  (mrp-and-quote `0.0.516-beta`). Both are on `feature`, and QuoteJourneyService `feature` is deployed to feature-dev.
- **Next step:** re-run the comparison for 3C053A54 against feature-dev, then release with QuoteJourneyService.

## 5. New business accidental damage pre-selected as "None"

- **What:** on an MRP quote of a policy that started in NHI, the accidental damage **None** button is filled where NHI
  leaves it empty. This happened on 3C053A54 (2026-10-19) as well as the two policies in
  [the write-up](accidental-damage-none-vs-not-chosen.md).
- **Decision (2026-10-19):** on new business, the level stays unset until the customer answers it through the overrides.
  Renewals and MTAs keep "None". This replaces the 2026-10-14 decision to keep showing "None".
- **Fix:** merged as QuoteJourneyService PR 25318, on `feature` and deployed to feature-dev. The write-up has the
  details and the one known limitation.
- **Next step:** underwriting and compliance to confirm that asking again after a reload is acceptable; then, as for
  issue 4, re-run the comparison and release with QuoteJourneyService.

## 6. MRP and NHI disagree on high-risk items cover

- **What:** on `3763F4DCDDE74265A3F3A024E8CEE3C9` (2026-10-19), the MRP quote page dropped a £2,000 pedal cycle with
  away-from-home cover ("You've chosen not to specify any items", plus the "covered under personal possessions" banner).
  NHI showed it included.
- **Evidence:** the stored MRP and NHI's `CalculateQuotePremium` give different answers for the same policies:
  - `3763F4DCDDE74265A3F3A024E8CEE3C9/1`: MRP (Artemis quote `745576a7-04ef-436a-9bc6-5fb01c8f1bf8`) has
    `isHighRiskItemsAllowed` and `isPersonalPossessionsAllowed` false; NHI (Artemis quote
    `82b3ec8a-44cc-465f-8f21-36e4b32366c9`) has `IsHighRiskHighValueItemsAllowed` and `IsGeneralValuablesCoveredAllowed`
    true.
  - Replacement quote `FB6D32967660432787A35483950308A3/1`: MRP (Artemis quote `5cd8dfa5-7755-4533-b661-75cfb7b278c3`)
    false/false; NHI (Artemis quote `6a389e5a-7c29-43a7-8c14-7fb03edbb789`) true/true.
  - Control `E9BC79F1468E45E896BC1182F2F35B85/1`: both true.
  - Neither MRP is unoccupied, unoccupied for renovation, or declined.
- **Why MRP drops the item:** GoPackages' mrp-and-quote mapper (`getListedItems`) sets each item's `includeInQuote`
  from the MRP's `isHighRiskItemsAllowed`, so MRP follows the stored rating correctly.
- **More cases (2026-10-21 run):** five more policies show it, for owners and mortgaged homes: MRP's re-quote returns
  `isHighRiskHighValueItemsAllowed` and `isGeneralValuablesCoveredAllowed` as `false` where NHI returns `true`, so MRP
  shows **Personal possessions: Not Included**. They are `1A13B1F1243841B4BB2A9DD9340868B3`,
  `73CDBA85021E4DD6AF2EB8BDBEFB57E2`, `790E50D7F20E4672855A529A75A36AAD`, `5E9CA3D0E80B4278B4D896612B2CEF52` and
  `6284D0B9487B4C63ACE4EC0D5979E4BD`; scenarios are in [MRP refuses cover that NHI allows](mrp-cover-allowed-differences.md).
- **Next step:** escalate to the rating team: which answer is right, and why do the two ratings of one policy differ?
  In Artemis both flags come from `ArtemisRiskAllowedCoverv004` (property use, ownership, furnished, unoccupied).

## 7. Endorsements are formatted differently on NHI and MRP

- **What:** on `E9BC79F1468E45E896BC1182F2F35B85` (2026-10-19), the `BIKESEC` endorsement is one paragraph on NHI and
  two on MRP, which moves everything below it down a line.
- **Cause:** the wording is the same: the MRP's `endorsementHtml` and NHI's `CalculateQuotePremium` both have `</p><p>`
  between the sentences and `class="definition"` on defined terms. QuestionSetQuote's quote summary (NHI) runs every
  endorsement through `convertSpecificTermsItemsUsingMarkdown` (`server/nhiIntegration/getQuoteSummary.ts`), which
  sanitises the HTML: it drops the classes and merges the paragraphs. The MRP `save-details` response shows the HTML
  as QuoteJourneyService returns it.
- **Not a fix:** showing the MRP's `endorsementText` instead would not match either side. It is plain text with
  `\r\n` line breaks and `•` bullets, so as HTML its paragraphs and list would collapse into one block.
- **Decision (2026-10-19):** match NHI exactly for now, although NHI's sanitised version loses the definition styling.
- **Fix:** merged as QuestionSetQuote PR 25320 into `feature`. It runs the MRP quote summary paths through the same
  `convertSpecificTermsItemsUsingMarkdown` call as NHI. A test checks that this policy's MRP `BIKESEC` HTML becomes
  exactly NHI's text.
- **Next step:** deploy, then re-run the comparison.

## 8. MRP quote pages opened by GUID showed NHI's pricing

- **What:** the MRP quote summary opened by GUID (the `TCAS Quote Summary (GUID)` entry point), `quotesummary#guid=<guid>&source=tcas`, showed NHI's pricing
  and cover until the agent clicked Return to quote. On feature-dev, for quote `3189b295-cec8-470b-b352-4ab196e50bd3`
  (a tenant), `GET /api/quote-summary/<guid>/user/<agent>?source=tcas` returned `buildingsIsAllowed: true`, while the
  policy route for the same quote returned MRP's `false`.
- **Cause (QuestionSetQuote):** the GUID quote summary and quote result routes ignored `source` and always priced through
  NHI's `CalculateQuotePremium`. The page also loaded MRP answers with `?nhi=true&source=tcas`, naming both sources.
- **Fix:** merged as QuestionSetQuote PR 25403 (`f58dd8e8`, `feature`, 2026-10-21), with follow-up PR 25411 in review.
  - `source=tcas` GUID requests are priced through QuoteJourneyService's quote-GUID endpoint
    (`/api/{new-business|mid-term-adjustment|renewal}/quote-guid/{quoteGuid}/user/{user}/quote-with-overrides`).
  - Policy-based MRP pricing uses the quote type too, instead of always `new-business`.
  - An `/api` middleware rejects ambiguous MRP requests with a 400.
- **Rules (decided 2026-10-21):**
  - `source=tcas` always means MRP data, never NHI; there is no fallback to NHI.
  - A request with `source=tcas` must not carry `nhi` at all, with any value or none; it gets a 400.
  - MRP data always needs a `policyDetailsId` and `historyId`. A quote GUID may be used instead only where
    QuoteJourneyService has a `quote-guid` equivalent of the endpoint (for example `GET /answers/quote-guid/{quoteGuid}`
    beside `GET /answers/{policyDetailsId}/{historyId}`). Answers fetched by quote GUID carry `policyDetailsId` and
    `historyId` in their metadata; without them the request gets a 400.
  - The quote type (new business, MTA or renewal) comes from the answers' metadata `quoteType`.
- **Assumptions to confirm** (made while fixing, recorded in PRs 25403 and 25411):
  - `generateNhiGuid` with `source=tcas` is rejected with a 400, as `nhi` is, and the client no longer sends it.
  - Answers with no valid `quoteType` (`nb`, `mta` or `ren`) get a 400. Policy-based requests used to be priced as new
    business. QuoteJourneyService answers have carried `quoteType` in every capture seen.
  - A repeated `source` that includes `tcas` gets a 400, and query keys are matched whatever their case.
  - MRP quotes are priced as the answers' agent, then the request's agent (ignoring the `none` placeholder), then the
    application.
  - MTA and renewal quotes are now priced through their own endpoints, so their prices may change.
- **Next step:** review and merge PR 25411, deploy to feature-dev, then re-run the comparison. The MRP page should then
  show MRP's cover before the re-quote.

## 9. MRP answers were saved to NHI

- **What (QuestionSetQuote):** MRP answers reached NHI in two ways:
  - `POST /api/answers` ran the incremental NHI save on every section move, with no check for MRP answers.
  - `POST /api/quote-summary/:quoteGuid`, used after browser back or forward, saved the posted answers to NHI and priced
    them there.
- **Fix:** merged in QuestionSetQuote PR 25403. MRP answers skip the incremental NHI save. Posted MRP answers are
  priced through the quote-GUID endpoint instead. PR 25411 also saves them to the question set store as journey
  complete, as other answers are; that last part is an assumption to confirm.
- **Next step:** deploy.

## 10. MRP shows a £1 buildings sum insured

- **What:** on `4230522AFAA2430E97FF8EDFD9A6FF40` (2026-10-21), the MRP quote page shows a buildings **Sum insured** of
  £1, in the Full accidental damage column too, where NHI shows £1,619,862.
- **Cause:** MRP's `save-details` returns `buildingsSumInsured: 1619862.675` (three decimal places); the quote summary
  returns `1619862.68`. The quote page's currency formatting appears to fail on the third decimal place. Not confirmed
  in the code.
- **Next step:** round to two decimal places where QuoteJourneyService builds the response, or make the quote page's
  formatting cope, or both.

## 11. MRP drops Contents insurance for a home owner

- **What:** on `106D1920D02642E2A0F55131BB75ED7D` (2026-10-21), the customer owns the home outright, but MRP's re-quote
  returns `contentsIsAllowed: false` and hides the Contents insurance row; NHI returns `true`.
- **Likely related:** issues 2 and 6, where the MRP re-rate refuses cover NHI allows. Which answer triggers it is not
  known.
- **Next step:** find the answer that disallows contents, then take it to the rating team with issue 6.

## 12. playwright-diff flags rendering noise

- **What (2026-10-21):** three pages differ only in how they render, not in content.
  - `BB52A54C361C4A8B9BA9227AED7379A5` (0.18%) and `F04BDA6BBD0E497299E21DCF1099902F` (0.16%) have small edge
    differences across the whole page; the crops look identical and only low-confidence OCR text "differs".
  - On `855FF5724E9A48DCA0040D55C2652428`, the Property circumstances step in the progress bar has an outlined tick on
    NHI and a filled one on MRP, probably a step state or a hover effect when the screenshot is taken.
- **Next step:** raise `--threshold` (default 20), or stop counting a page as different when every changed region is
  small and its OCR text is unchanged; check the progress bar's state before the screenshot.

## 13. NHI's saved quote and its re-quote disagree

- **What (2026-10-21, captured between 14:18 and 14:30 UTC):** on six policies, NHI's page priced the quote twice:
  first its quote summary (`GET /api/quote-summary/<quote GUID>/user/<agent>`), then a re-quote
  (`POST /api/save-details`). The two disagree on the same answers. The page shows the re-quote, which matches MRP's
  quote, so NHI's and MRP's pages are identical; this is a difference within NHI, not between NHI and MRP.
- **How the two differ, on all six:**
  - NHI's quote summary is a conditional quote (`isConditional: true`); the re-quote is not.
  - The quote summary has the `EXTPERIL` endorsement (Amendments to cover for unoccupied property); the re-quote has
    `UNOCCOVR` (Cover limitations for unoccupied property) instead.
  - The quote summary has a £1,000 Subsidence, Landslip and Heave excess; the re-quote has none.
  - The quote summary's annual premium is higher. On the first policy below, the quote summary also has a £2,500
    Flooding excess that the re-quote does not.
- **Policies** (each historyId 1; annual premium in NHI's quote summary, then in its re-quote and in MRP's quote):
  - policyDetailsId `323B3C1BB0D9423EADD80A5E76C6B9A6`, quote GUID `8914c660-9955-4dee-8b68-24249198e5c3`: £329.22,
    £301.09
  - policyDetailsId `6C68B0B7C5B64073B55345E404646C66`, quote GUID `8a420f25-e85e-43fd-a9e8-f3a85e956292`: £329.22,
    £297.96
  - policyDetailsId `77FC32F83C1744ECA5B77A3C80595E4B`, quote GUID `988cec39-2c9a-48a5-b61c-0125ec418935`: £597.43,
    £361.44
  - policyDetailsId `94B3603B4FD14CE3B26BBF2129958CE9`, quote GUID `74923b3b-9cba-43a8-b2fe-66a237f1b338`: £516.05,
    £367.23
  - policyDetailsId `AC46A23B21F948A48B821AB3A4FDDEA9`, quote GUID `21de8ff3-3d42-47e6-ade9-3d6a0798a4bd`: £350.68,
    £286.94
  - policyDetailsId `D9633A9C18C643608FDEE7F2D0D810E9`, quote GUID `b0581376-ca35-41d3-8d1c-20a1544767c9`: £204.00,
    £173.08
- **Found by:** `npm run summarise differences`, which first compared NHI's quote summary with MRP's last response and
  reported these as NHI/MRP differences. It now compares each side's last quote response, the one its page showed, so
  these six no longer appear there.
- **Unknown:** why NHI's page re-quoted these quotes, and which of the two quotes is right for the answers.
- **Next step:** compare the answers in each policy's saved NHI quote with those in its re-quote
  (`nhi-api/*-GET-answers-*.json` and `*-POST-answers-*.json` in the playwright-diff output folder), then take the
  difference to NHI.

## Closed

- **Accidental damage "None" vs not chosen:** reopened as issue 5 after the 2026-10-19 decision.
- **Conviction offence arriving blank:** fixed by PolicyAPIService PR 25168 and QuoteJourneyService PR 25170.
- **Endorsements listed in a different order:** NHI's quote summary and MRP's `save-details` return the same
  endorsements in different, but stable, orders (on `14F8FDA76C1B486D8AEF9FCB721E9A2E`, 2026-10-20: `BIKESEC` then
  `UNOCCLAU` on NHI, the reverse on MRP). Known and accepted, so playwright-diff now puts them in title order before
  each screenshot and records both orders in `result.json` (see the README's "Standardised page").
