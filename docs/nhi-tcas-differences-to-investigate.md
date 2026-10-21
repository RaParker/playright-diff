# NHI and TCAS differences to investigate

**Draft for review by the relevant teams before anyone acts on it.** From the playwright-diff comparison of NHI and
TCAS quote pages on feature-dev, run on 2026-10-21. Each section below is one kind of difference, with one policy you
can open to see it for yourself. The issue numbers refer to [open issues](open-issues.md).

## Summary

The run compared 1,218 quote pages: 103 differed, 19 failed to capture and 25 were declined quotes. Every difference
comes from the TCAS rating refusing cover that NHI allows, or from how TCAS returns a sum insured:

1. **Tenants: TCAS hides Buildings insurance, NHI offers it:** 95 pages ([open issue 2](open-issues.md)).
2. **TCAS doesn't include Personal possessions and high-risk items, NHI does:** 8 pages
   ([open issue 6](open-issues.md)).
3. **Home owner: TCAS hides Contents insurance, NHI offers it:** 1 page, also one of the 8 in section 2
   ([open issue 11](open-issues.md)).
4. **TCAS shows a £1 buildings sum insured, NHI shows the real amount:** 1 page, also one of the 8 in section 2
   ([open issue 10](open-issues.md)).

Each page shows faithfully what its own rating returned (NHI's or TCAS's), so sections 1 to 3 need a decision on which
rating is right.

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

## 1. Tenants: TCAS hides Buildings insurance, NHI offers it

- **Example:** policy `0503FE0FF7904A4899C471DA352E7BD4`, history 1, a tenant renting from a landlord (`RPL01`). Quote
  GUID `3189b295-cec8-470b-b352-4ab196e50bd3`.
  - [Open the NHI quote page](https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=3189b295-cec8-470b-b352-4ab196e50bd3&callmediauser=richard.parker&bid=1066)
  - [Open the TCAS quote page](https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=3189b295-cec8-470b-b352-4ab196e50bd3&source=tcas&callmediauser=richard.parker&bid=1066)
- **What you see:** NHI shows a **Buildings insurance** row with an empty **Select** box above **Contents insurance**.
  TCAS has no Buildings row, so its page is 109px shorter and everything below moves up (12.09% of pixels changed).
- **Data:** NHI's quote summary has `buildingsIsAllowed: true`; TCAS's has `buildingsIsAllowed: false`.
- **Scale:** 95 pages, every one a tenant: 69 rent from a landlord (`RPL01`), 14 from a housing association (`RHA01`)
  and 12 from a local authority (`RLA01`). No owner or mortgaged home lost the row on TCAS.
- **Side effect:** because everything on the TCAS page moves up, any other difference further down these pages is
  hidden, so they need comparing again once this is settled.
- **Question for pricing and underwriting:** may a tenant buy buildings cover? If not, NHI needs fixing; if so, the
  TCAS rating (Policy API or Artemis) does.

## 2. TCAS doesn't include Personal possessions and high-risk items, NHI does

- **Example:** policy `1A13B1F1243841B4BB2A9DD9340868B3`, history 1, a mortgaged home (`MOR01`). Quote GUID
  `b97cc0fb-828c-47f8-a77e-fbbf9f5066f9`.
  - [Open the NHI quote page](https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=b97cc0fb-828c-47f8-a77e-fbbf9f5066f9&callmediauser=richard.parker&bid=1066)
  - [Open the TCAS quote page](https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=b97cc0fb-828c-47f8-a77e-fbbf9f5066f9&source=tcas&callmediauser=richard.parker&bid=1066)
- **What you see:** under **Contents insurance**, NHI shows **Personal possessions cover** as £0 with **Edit**, and the
  page ends with **Recalculate your quote**. TCAS shows **Personal possessions: Not Included** and ends with
  **Continue**. The pages are the same height, so only 0.07% of pixels changed.
- **Data:** NHI's quote summary has `isHighRiskHighValueItemsAllowed` and `isGeneralValuablesCoveredAllowed` both
  `true`; TCAS's has both `false`. The other cover flags agree.
- **Scale:** 8 pages, none of them tenants: 4 owned outright (`OWN01`), 3 mortgaged (`MOR01`) and 1 recorded
  as `ky99`. Where the customer listed items, TCAS can also drop them; on `3763F4DCDDE74265A3F3A024E8CEE3C9` it drops a
  pedal cycle with away-from-home cover.
- **Question for the rating team:** which answer is right, NHI's or TCAS's, and why do their ratings of the same answers
  differ? In Artemis
  both flags come from `ArtemisRiskAllowedCoverv004` (property use, ownership, furnished, unoccupied).

## 3. Home owner: TCAS hides Contents insurance, NHI offers it

- **Example:** policy `106D1920D02642E2A0F55131BB75ED7D`, history 1, a home owned outright (`OWN01`). Quote GUID
  `48d4abbc-6fa2-4c18-b2f2-db7fddcc5fbf`.
  - [Open the NHI quote page](https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=48d4abbc-6fa2-4c18-b2f2-db7fddcc5fbf&callmediauser=richard.parker&bid=1066)
  - [Open the TCAS quote page](https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=48d4abbc-6fa2-4c18-b2f2-db7fddcc5fbf&source=tcas&callmediauser=richard.parker&bid=1066)
- **What you see:** NHI shows a **Contents insurance** row with **Add Contents cover**. TCAS has no Contents row, so its
  page is 118px shorter (7.52% of pixels changed).
- **Data:** NHI's quote summary has `contentsIsAllowed: true`; TCAS's has `contentsIsAllowed: false`. TCAS also returns
  the two personal possessions flags in section 2 as `false`.
- **Scale:** this page only.
- **Question:** which answer makes TCAS refuse contents cover? Take it to the rating team with section 2.

## 4. TCAS shows a £1 buildings sum insured, NHI shows the real amount

- **Example:** policy `4230522AFAA2430E97FF8EDFD9A6FF40`, history 1, a mortgaged home (`MOR01`). Quote GUID
  `9751c32f-f6f8-4346-a7e4-f5d3bb0b7bbe`.
  - [Open the NHI quote page](https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=9751c32f-f6f8-4346-a7e4-f5d3bb0b7bbe&callmediauser=richard.parker&bid=1066)
  - [Open the TCAS quote page](https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=9751c32f-f6f8-4346-a7e4-f5d3bb0b7bbe&source=tcas&callmediauser=richard.parker&bid=1066)
- **What you see:** the buildings **Sum insured** is £1,619,862 on NHI and £1 on TCAS, in both places it appears
  (including the Full accidental damage column). 0.07% of pixels changed.
- **Data:** NHI's quote summary has `buildingsSumInsured: 1619862.68`; TCAS's has `1619862.675`, three decimal places.
  The TCAS quote page's currency formatting appears to fail on the third decimal place; this is not confirmed in the code.
  TCAS also returns the two personal possessions flags in section 2 as `false`.
- **Scale:** this page only.
- **Question:** should QuoteJourneyService round the sum insured to two decimal places, should the TCAS quote
  page's formatting cope with more, or both?

## Not covered above

- **Six tenant pages still show NHI and TCAS as identical.** All six rent from a landlord (`RPL01`). They were captured
  on 2026-10-20 and early on 2026-10-21, before the TCAS page showed TCAS's cover, although TCAS's response for each
  already had `buildingsIsAllowed: false`. Running them again should add them to section 1. Each is history 1:
  - `1F024FF8D7FE4BBEAB4CFA408373AB1B`: quote `1766809c-fb6a-4a64-aca1-d2899a9177a2`
  - `295B10C2AA1F4A95825A153FC7BFF86D`: quote `700dae9d-40a9-4971-8717-bc78225b5299`
  - `733AB9BECBD94620BBBAC05DCE2945E7`: quote `2ebaffa1-ab71-489c-aad3-2b9ca72e9a8c`
  - `BB8AF0639DF747C0A3B1E944B3B2A4F0`: quote `cb659d56-0332-4751-b234-558cc65f5f1a`
  - `C34C0FE51091491D9A6EAE707B4CAD9A`: quote `ad27133b-1df8-4e5f-b3da-e41a99b861cd`
  - `DFF53EF0C0F042C496DBBB1141EFB12E`: quote `2208a839-f6f6-41ba-a663-c465a19dddb0`
- **One tenant from the last run is missing.** `3831A3A00C88465DB46341EC0BEB48D7` (history 1, quote
  `6e9f70f2-2c0f-4e18-9862-a0221b5d4888`) failed this time because the NHI quote did not appear within 5 clicks.
- **Rendering noise ([open issue 12](open-issues.md)) is gone:** the three pages that differed only in how NHI and TCAS
  render now have no changed pixels. Each is history 1:
  - `BB52A54C361C4A8B9BA9227AED7379A5`: quote `463bfebe-c8d3-4b26-962f-970f0ce524ce`
  - `F04BDA6BBD0E497299E21DCF1099902F`: quote `a3626fc0-ca13-4555-854f-14c5c55bc7b7`
  - `855FF5724E9A48DCA0040D55C2652428`: quote `b008ebc4-dfdd-451c-a275-7328fec90797`
- **Not investigated here:** the 19 failed captures and the 25 declined quotes.
