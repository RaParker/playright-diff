# TCAS re-quote priced new business as a mid-term adjustment

**Draft for review by pricing, underwriting and compliance before anyone acts on it.**

Environment: dev / feature-dev, 2026-10-14. Policies `718CA449FCFC4A959D99124EDC81EA87` and
`77D5FA3FF40441F28699E5AD6F3F0C8C`, history ID 1; each has an unspent criminal conviction in TCAS.

## Summary

When an answer was changed on the TCAS quote page and the user clicked **Return to quote**, the new-business quote was
re-priced as a **mid-term adjustment (MTA)**. MTA pricing has no £50 admin fee, no broker commission and only the
basic add-ons, so the re-quote was much cheaper than the same quote in NHI. This is fixed, and both policies' TCAS and
NHI quote pages now show the same price, fee, add-ons and excesses.

| Policy   | NHI quote                     | TCAS re-quote before the fix  | TCAS re-quote after the fix   |
| -------- | ----------------------------- | ----------------------------- | ----------------------------- |
| 718CA449 | £164.11, £50 fee, all add-ons | £74.56, £0 fee, basic add-ons | £164.11, £50 fee, all add-ons |
| 77D5FA3F | £137.62, £50 fee, all add-ons | £53.44, £0 fee, basic add-ons | £137.62, £50 fee, all add-ons |

## Cause

**Return to quote** sends `POST /api/save-details` with `source: tcas` in the answers' metadata. QuestionSetQuote
(QSQ) then prices the answers through QuoteJourneyService (QJS) and PolicyApiService, never NHI:

1. QSQ `POST /api/save-details` (`server/questionSetNhiFeature.ts`): `source === 'tcas'` calls
   `policyApiFeature.saveAnswersAndQuote`, which only prices; it saves nothing.
2. QJS `POST /quotejourneyservice/api/new-business/{policyDetailsId}/1/user/{user}/quote-from-answer-map`.
3. QJS `service/getQuoteFromAnswerMap.go` chose the PolicyApiService endpoint with a switch that handled renewal and
   sent **every other quote type, including new business, to MTA**. PolicyApiService had no new-business
   `quote-from-policy-details` endpoint to call instead.
4. PolicyApiService
   `POST /policyapiservice/api/mid-term-adjustment/{policyDetailsId}/1/user/quotejourneyservice-dev/quote-from-policy-details`
   priced it as an MTA.

Datadog traces of the two re-quotes show the call chain: `13159681396393944291` (718CA449, 08:59:17 UTC) and
`10908695784499645763` (77D5FA3F, 09:00:24 UTC).

The same record priced both ways by PolicyApiService (718CA449's quote, policyDetailsId
`5397EB2E20054AC2BD88B98CCD8AE861`):

| PolicyApiService call                                  | Gross   | Admin fee | AXA commission | Add-ons                                                   |
| ------------------------------------------------------ | ------- | --------- | -------------- | --------------------------------------------------------- |
| `GET new-business/…/quote`                             | £164.11 | £50       | £35.31         | Basic and full Home Emergency, Legal Expenses, KeyProtect |
| `POST mid-term-adjustment/…/quote-from-policy-details` | £74.56  | £0        | £0.00          | Basic Home Emergency and basic Legal Expenses only        |

The net risk premium (£64.53) is the same; the £89.55 difference is the £50 fee, £35.31 commission and £4.24 IPT.

A second, display-only bug showed up once the prices matched: after the re-quote, the Legal Expenses excess was listed
twice ("Legal Expenses excess £250" and "Legal Expenses £250"). QJS lists its add-on excesses (flagged `isAddOn`), and
QSQ's `transformQuoteResult` then added NHI-style add-on excesses as well.

## Fix

| Repository              | PR    | Change                                                                                       |
| ----------------------- | ----- | -------------------------------------------------------------------------------------------- |
| PolicyAPIService        | 25142 | `quote-from-policy-details` and `quote-and-save-from-policy-details` for new business        |
| GoPackages              | 25147 | `policy-api-client` regenerated with the new-business methods (0.0.239-beta)                 |
| GoPackages              | 25155 | `stub-policy-api-client` methods (0.0.93-beta); `mock-policy-api-client` bump (0.0.126-beta) |
| QuoteJourneyService     | 25156 | Price new business through the new-business endpoints; unknown quote types are an error      |
| QuestionSetQuote        | 25159 | Drop QJS's `isAddOn` excesses before adding the NHI-style ones                               |
| QuestionSetEngineServer | 25162 | `/api/healthcheck` reports the deployed version (e.g. `1.0.7971-feature`)                    |
| QuestionSetQuote        | 25163 | `server/engineServer` submodule moved to include 25162                                       |

PR 25142 also rejects a request whose body policy doesn't match the path (400), returns `Locked` rather than 500 for a
locked policy, and stops new-business quote-and-save accepting Renewal Invited policies.

## Remaining differences

After the fix, the pages differ only in these, both left as they are on purpose:

- **Buildings insurance row (718CA449 only):** the customer rents from the local authority (`ownershipId` `RLA01`).
  Artemis returns `isBuildingsAllowed: false`, so TCAS hides the row; NHI still offers buildings cover. TCAS is taken to
  be correct; NHI's behaviour is for pricing and underwriting to confirm.
- **Accidental damage "None" selected (both):** NHI shows no selection; TCAS shows "None" selected. The TCAS page sends
  an empty value ("not chosen"), but the record already has `'None'` stored (written when the NHI quote was saved to
  Transactor), and the shared `mrp-and-quote` mapper reports Artemis's quality-None provision as the level "None". After
  the re-quote the page saves `'None'` back, so "not chosen" becomes "chose None". A fix would start in the mapper:
  report no level when the submitted value is empty.

Fields that differ in the data but not on screen: `preferredPaymentMethod`, `tier`, `is7500CoverSufficient`,
`callCentreUserCode`, the quote reference and an endorsement's `<i class="definition">` markup.

## Reproduce

All URLs are for 718CA449; 77D5FA3F's replacement quote GUID is `a90ebcff-1517-4b51-8e66-be90e51c5a05` (policyDetailsId
`A90EBCFF15174B518E66BE90E51C5A05`).

1. Create the replacement NHI quote for the TCAS policy:

   ```text
   POST https://quotes-feature-dev.homeprotect.co.uk/api/nhi/quote-guid?agentId=richard.parker&branchCode=1066&callMediaUser=richard.parker&policyDetailsId=718CA449FCFC4A959D99124EDC81EA87&historyId=1
        {"coverStartDate":"2026-10-14"}
   → 200 5397eb2e-2005-4ac2-bd88-b98ccd8ae861
   ```

2. Open the TCAS quote page
   <https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=5397eb2e-2005-4ac2-bd88-b98ccd8ae861&source=tcas&callmediauser=richard.parker&bid=1066>,
   click **Continue with quote**, set the conviction offence to **Theft** on Household details (the conviction types
   `MPP101` / `AGG99` arrive as an empty offence) and click **Return to quote**. The re-quote is
   `POST /api/save-details`; check its `quoteResult.quoteAmounts` and `compulsoryExcesses`.
3. Compare PolicyApiService's new-business and MTA pricing of the same record:

   ```text
   GET  https://wkservices-feature-dev.avantiagroup.co.uk/policyapiservice/api/policy/5397EB2E20054AC2BD88B98CCD8AE861/1/preset/quote-journey/with-hash
   GET  https://wkservices-feature-dev.avantiagroup.co.uk/policyapiservice/api/new-business/5397EB2E20054AC2BD88B98CCD8AE861/1/user/richard.parker/quote
   POST https://wkservices-feature-dev.avantiagroup.co.uk/policyapiservice/api/new-business/5397EB2E20054AC2BD88B98CCD8AE861/1/user/richard.parker/quote-from-policy-details
   POST https://wkservices-feature-dev.avantiagroup.co.uk/policyapiservice/api/mid-term-adjustment/5397EB2E20054AC2BD88B98CCD8AE861/1/user/richard.parker/quote-from-policy-details
        body for both POSTs: {"policy": <the with-hash response>}
   ```

   Each quote writes an `ArtemisQuoteGuidLog` row but doesn't change the policy.

The playwright-diff command `npm run quote-page -- 718CA449FCFC4A959D99124EDC81EA87 1 --no-ocr` runs the NHI and TCAS
journeys, compares the pages and saves every `/api/` response under
`D:\temp\playright-diff-output\718CA449FCFC4A959D99124EDC81EA87-1\`. The saved responses contain the test policy's
personal details and conviction, so share them internally only.

## Open questions

1. Why does NHI's `CalculateQuotePremium` return 500 since 14 Oct for the original MRP quote GUIDs (`87f68d27…` for
   718CA449, `11c88e9b…` for 77D5FA3F), which it priced on 13 Oct?
2. Should conviction types `MPP101` and `AGG99` reach the quote journey as an offence answer, rather than empty?
3. Should NHI offer buildings cover to a customer who rents from the local authority?
