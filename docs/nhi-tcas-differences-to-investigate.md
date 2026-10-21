# NHI and TCAS differences to investigate

**Draft for review by the relevant teams before anyone acts on it.** From the playwright-diff comparison of NHI and
TCAS quote pages on feature-dev, run on 2026-10-21. Each section below is one kind of difference, with one policy you
can open to see it for yourself. The issue numbers refer to [open issues](open-issues.md).

## Summary

The run compared 1,218 quote pages: 103 differed, 19 failed to capture and 25 were declined quotes. Every difference
comes from the TCAS rating refusing cover that NHI allows, or from how TCAS returns a sum insured:

1. **Buildings insurance missing for tenants:** 95 pages ([open issue 2](open-issues.md)).
2. **Personal possessions and high-risk items not allowed:** 8 pages ([open issue 6](open-issues.md)).
3. **Contents insurance missing for a home owner:** 1 page, also one of the 8 in section 2
   ([open issue 11](open-issues.md)).
4. **£1 buildings sum insured:** 1 page, also one of the 8 in section 2 ([open issue 10](open-issues.md)).

Each page shows faithfully what its own rating returned, so sections 1 to 3 need a decision on which rating is right.

## How to reproduce

1. Open the example's **NHI** link and click through any summary or assumptions pages until the quote shows.
2. Open the example's **TCAS** link for the same quote GUID and click through in the same way.
3. Compare the part of the page named in the example.

Notes:

- The links are feature-dev. `callmediauser=richard.parker` is the agent the comparison ran as; replace it with your
  own username to have the quotes recorded against you.
- All four quote GUIDs were checked on 2026-10-21: NHI's and TCAS's quote summary APIs returned 200 for each. TCAS's
  page now shows TCAS's cover as soon as it opens (the fix for open issue 8 is on feature-dev), so there is no need to
  click **Return to quote**.
- The comparison's screenshots, crops and captured API responses are in the playwright-diff output folder under
  `<policy ID>-1` (`nhi.png`, `tcas.png`, `diff.png`, `nhi-api/`, `tcas-api/`).

## 1. Buildings insurance missing for tenants

- **Example:** policy `0503FE0FF7904A4899C471DA352E7BD4`, history 1, a tenant renting from a landlord (`RPL01`). Quote
  GUID `3189b295-cec8-470b-b352-4ab196e50bd3`.
  - NHI:\
    <https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=3189b295-cec8-470b-b352-4ab196e50bd3&callmediauser=richard.parker&bid=1066>
  - TCAS:\
    <https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=3189b295-cec8-470b-b352-4ab196e50bd3&source=tcas&callmediauser=richard.parker&bid=1066>
- **What you see:** NHI shows a **Buildings insurance** row with an empty **Select** box above **Contents insurance**.
  TCAS has no Buildings row, so its page is 109px shorter and everything below moves up (12.09% of pixels changed).
- **Data:** NHI's quote summary has `buildingsIsAllowed: true`; TCAS's has `buildingsIsAllowed: false`.
- **Scale:** 95 pages, every one a tenant: 69 rent from a landlord (`RPL01`), 14 from a housing association (`RHA01`)
  and 12 from a local authority (`RLA01`). No owner or mortgaged home lost the row.
- **Side effect:** the shift hides any other difference further down these pages, so they need comparing again once
  this is settled.
- **Question for pricing and underwriting:** may a tenant buy buildings cover? If not, NHI needs fixing; if so, the
  TCAS rating (Policy API or Artemis) does.

## 2. Personal possessions and high-risk items not allowed on TCAS

- **Example:** policy `1A13B1F1243841B4BB2A9DD9340868B3`, history 1, a mortgaged home (`MOR01`). Quote GUID
  `b97cc0fb-828c-47f8-a77e-fbbf9f5066f9`.
  - NHI:\
    <https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=b97cc0fb-828c-47f8-a77e-fbbf9f5066f9&callmediauser=richard.parker&bid=1066>
  - TCAS:\
    <https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=b97cc0fb-828c-47f8-a77e-fbbf9f5066f9&source=tcas&callmediauser=richard.parker&bid=1066>
- **What you see:** under **Contents insurance**, NHI shows **Personal possessions cover** as £0 with **Edit**, and the
  page ends with **Recalculate your quote**. TCAS shows **Personal possessions: Not Included** and ends with
  **Continue**. The pages are the same height, so only 0.07% of pixels changed.
- **Data:** NHI's quote summary has `isHighRiskHighValueItemsAllowed` and `isGeneralValuablesCoveredAllowed` both
  `true`; TCAS's has both `false`. The other cover flags agree.
- **Scale:** 8 pages, none of them tenants: 4 owned outright (`OWN01`), 3 mortgaged (`MOR01`) and 1 recorded
  as `ky99`. Where the customer listed items, TCAS can also drop them; on `3763F4DCDDE74265A3F3A024E8CEE3C9` it drops a
  pedal cycle with away-from-home cover.
- **Question for the rating team:** which answer is right, and why do two ratings of the same answers differ? In Artemis
  both flags come from `ArtemisRiskAllowedCoverv004` (property use, ownership, furnished, unoccupied).

## 3. Contents insurance missing for a home owner

- **Example:** policy `106D1920D02642E2A0F55131BB75ED7D`, history 1, a home owned outright (`OWN01`). Quote GUID
  `48d4abbc-6fa2-4c18-b2f2-db7fddcc5fbf`.
  - NHI:\
    <https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=48d4abbc-6fa2-4c18-b2f2-db7fddcc5fbf&callmediauser=richard.parker&bid=1066>
  - TCAS:\
    <https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=48d4abbc-6fa2-4c18-b2f2-db7fddcc5fbf&source=tcas&callmediauser=richard.parker&bid=1066>
- **What you see:** NHI shows a **Contents insurance** row with **Add Contents cover**. TCAS has no Contents row, so its
  page is 118px shorter (7.52% of pixels changed).
- **Data:** NHI's quote summary has `contentsIsAllowed: true`; TCAS's has `contentsIsAllowed: false`. TCAS also returns
  the two personal possessions flags in section 2 as `false`.
- **Scale:** this page only.
- **Question:** which answer makes TCAS refuse contents cover? Take it to the rating team with section 2.

## 4. £1 buildings sum insured on TCAS

- **Example:** policy `4230522AFAA2430E97FF8EDFD9A6FF40`, history 1, a mortgaged home (`MOR01`). Quote GUID
  `9751c32f-f6f8-4346-a7e4-f5d3bb0b7bbe`.
  - NHI:\
    <https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=9751c32f-f6f8-4346-a7e4-f5d3bb0b7bbe&callmediauser=richard.parker&bid=1066>
  - TCAS:\
    <https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=9751c32f-f6f8-4346-a7e4-f5d3bb0b7bbe&source=tcas&callmediauser=richard.parker&bid=1066>
- **What you see:** the buildings **Sum insured** is £1,619,862 on NHI and £1 on TCAS, in both places it appears
  (including the Full accidental damage column). 0.07% of pixels changed.
- **Data:** NHI's quote summary has `buildingsSumInsured: 1619862.68`; TCAS's has `1619862.675`, three decimal places.
  The quote page's currency formatting appears to fail on the third decimal place; this is not confirmed in the code.
  TCAS also returns the two personal possessions flags in section 2 as `false`.
- **Scale:** this page only.
- **Question:** should QuoteJourneyService round the sum insured to two decimal places, should the quote page's
  formatting cope with more, or both?

## Not covered above

- **Six tenant pages still show as identical.** They were captured on 2026-10-20 and early on 2026-10-21, before the
  TCAS page showed TCAS's cover, although TCAS's response for each already had `buildingsIsAllowed: false`. Running
  them again should add them to section 1.
- **One tenant from the last run is missing.** `3831A3A00C88465DB46341EC0BEB48D7` failed this time because the NHI
  quote did not appear within 5 clicks.
- **Rendering noise ([open issue 12](open-issues.md)) is gone:** the three pages that differed only in how they render
  no longer differ.
- **Not investigated here:** the 19 failed captures and the 25 declined quotes.
