# NHI and MRP differences to investigate

<!--
MAINTAINER NOTES (hidden when rendered). How to update this document from the current playwright-diff output, without
asking anyone. Follow every step; keep everything below the notes in the same structure.

1. Purpose and audience
   - Shared with other teams so they can see each kind of NHI/MRP difference for themselves. One example policy per
     kind of difference, never every affected policy. The only full lists are in "Not covered above".
   - Keep the draft banner. No customer names, addresses, emails or dates of birth (the screenshots and HTML contain
     them; never copy them). Policy IDs and quote GUIDs are fine, always in full (never shortened with an ellipsis).
   - Differences in the sex / jointNamesSex answers never matter; ignore them.

2. Sources (all read-only; never write into the output folder)
   - Output folder: DIFF_OUTPUT_DIR in the project's .env (D:\temp\playright-diff-output). One folder per policy,
     <policyDetailsId>-<historyId>.
   - Totals: `npm run summarise` (the Totals line), and the differing pages from `npm run summarise differences`.
     Check the startedAt range in each folder's result.json: say in the intro which run the figures are from, and
     whether some policies were run again later.
   - Per policy: result.json (outcome, endpoints: quote | referred | conditional | declined, issues), report.json
     (changedPercent, dimensions.before/after = NHI/MRP page sizes), nhi-api/ and tcas-api/ (NHI's
     *-GET-quote-summary-<quote GUID>-*.json; MRP's *-POST-save-details.json, else its quote-summary), and
     nhi-/tcas-quote-page-standardized.html (what each screenshot shows).
   - Quote GUID: the GUID in the NHI quote-summary file name or its url.
   - Ownership: answers["6516e060-3d1f-11ea-b235-d7e3a967f0e2"].customer in nhi-api/*-GET-answers-*.json
     (RPL01 landlord, RHA01 housing association, RLA01 local authority, OWN01 owned outright, MOR01 mortgaged; other
     codes such as ky99 are quoted as they are).

3. Sorting the differing pages into kinds
   - For each differing page, compare NHI's and MRP's buildingsIsAllowed, contentsIsAllowed,
     isHighRiskHighValueItemsAllowed, isGeneralValuablesCoveredAllowed and buildingsSumInsured, and the end points.
   - Current kinds (section: rule, open issue):
     1 Tenants: buildingsIsAllowed true on NHI, false on MRP (open issue 2).
     2 Personal possessions: both high-risk flags true on NHI, false on MRP (open issue 6).
     3 Contents: contentsIsAllowed true on NHI, false on MRP (open issue 11).
     4 Sum insured: MRP buildingsSumInsured with more than two decimal places, shown as £1 (open issue 10).
   - A page can be in more than one kind; say so ("also one of the 8 in section 2"), and make the counts add up.
   - A page that fits no kind: diff the visible text of the two standardised HTML files (tags, scripts and styles
     removed; leave out lines with names or emails) and the API flags to find the cause. Add a new section for it,
     linked to the matching open issue in open-issues.md, or say it has no open issue yet. Remove a section whose
     kind no longer occurs, and say so in the summary.
   - Pages that differ only in rendering (open issue 12) go under "Not covered above".

4. Choosing and checking each example
   - Keep the current example while it still shows its kind; otherwise pick the first affected policy in folder
     order (prefer one that shows only that kind).
   - Check each example's quote GUID on the day: GET
     https://quotes-feature-dev.homeprotect.co.uk/api/quote-summary/<quote GUID>/user/richard.parker and the same
     with ?source=tcas must both return 200, with the flags that show the difference. Record the date in
     "How to reproduce". If MRP's GUID route returns NHI's flags again, put back the Return to quote step.
   - "What you see": the visible-text diff of the standardised HTML (name the sections and buttons that differ, and
     which side shows what), the page heights and changedPercent from report.json.
   - "Data": the flags that differ, quoted with their values on each side. "Scale": the count, split by ownership
     where it matters. "Question": who decides, and what.

5. "Not covered above"
   - Tenants whose MRP response has buildingsIsAllowed false but whose pages match, and why (for example both
     ended on a referral: endpoints referred/referred, or "We need to double check a few details with you").
   - Failed policies that matter to a kind above (for example a tenant that failed), with their current issue.
   - Rendering-only differences, and pages that stopped differing since the last update.
   - Each item lists policyDetailsId and quote GUID, labelled, with its history ID. A list longer than about ten goes
     in its own section at the end of the document, linked from the item; not in a <details> block, whose blank line
     Prettier removes, so the list would not render.
   - Pages whose cover flags disagree but whose screenshots match are listed here too, by kind; only results with
     recorded end points count. Results captured before end points were recorded are not trusted: run them again
     rather than reading anything from them, and give their count under "Not investigated here".
   - End with the totals not investigated here (failed captures, declined quotes).

6. Conventions
   - The two sides are NHI and MRP. Never write TCAS in the prose, though identifiers that contain it stay as they are
     (the `&source=tcas` link parameter, the `tcas-api/` and `tcas.png` files). Say "MRP file" for
     <policyDetailsId>-1-mrp.json, so it is not confused with the MRP side.
   - Every heading and summary item says which side does what ("MRP hides …, NHI offers it").
   - Links: [Open the NHI quote page](https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=<quote GUID>&callmediauser=richard.parker&bid=1066)
     and [Open the MRP quote page](… the same, with &source=tcas after the GUID). Never bare <https://…> links.
   - Label IDs: "policyDetailsId `…`, historyId 1" and "quote GUID `…`".
   - "Running these pages again" stays general: `npm run quote-page -- <policyDetailsId> <historyId>`; no
     policy-specific loops.
   - UK English. Hard line breaks end in a backslash. Run `npx --yes prettier@3.7.4 --write` on this file, then
     commit it on its own to main (this project commits directly to main) with a docs: message.
-->

**Draft for review by the relevant teams before anyone acts on it.** From the playwright-diff comparison of NHI and
MRP quote pages on feature-dev, last updated on 2026-10-21. Every page this document counts as different, and every
page it lists, was captured between 13:33 and 14:33 UTC that day, with each side's end point (quote, referral,
conditional quote or decline) and both quote summaries recorded. Each section below is one kind of difference, with one
policy you can open to see it for yourself. The issue numbers refer to [open issues](open-issues.md).

## Summary

The output holds 1,248 compared quote pages: 112 differ, 10 are referrals on both sides and 1,126 are identical; 17
policies failed to capture. Every difference comes from the MRP rating refusing cover that NHI allows, or from how MRP
returns a sum insured:

1. **Tenants: MRP hides Buildings insurance, NHI offers it:** 102 pages ([open issue 2](open-issues.md)).
2. **MRP doesn't include Personal possessions and high-risk items, NHI does:** 10 pages
   ([open issue 6](open-issues.md)).
3. **Home owner: MRP hides Contents insurance, NHI offers it:** 1 page, also one of the 10 in section 2
   ([open issue 11](open-issues.md)).
4. **MRP shows a £1 buildings sum insured, NHI shows the real amount:** 1 page, also one of the 10 in section 2
   ([open issue 10](open-issues.md)).

Section 2's flags also disagree on 113 pages whose screenshots match, and 6 tenants with section 1's flags are
referrals on both sides; see "Not covered above". 995 of the identical pages are from older runs on 20 and 21 October,
captured before end points were recorded, so they have not been checked in the same way.

Each page shows faithfully what its own rating returned (NHI's or MRP's), so sections 1 to 3 need a decision on which
rating is right.

## How to reproduce

1. Open the example's **NHI** link and click through any summary or assumptions pages until the quote shows.
2. Open the example's **MRP** link for the same quote GUID and click through in the same way.
3. Compare the part of the page named in the example.

Notes:

- The links are feature-dev. `callmediauser=richard.parker` is the agent the comparison ran as; replace it with your
  own username to have the quotes recorded against you.
- All four quote GUIDs were checked on 2026-10-21: NHI's and MRP's quote summary APIs returned 200 for each. MRP's
  page now shows MRP's cover as soon as it opens (the fix for open issue 8 is on feature-dev), so there is no need to
  click **Return to quote**.
- The comparison's screenshots, crops and captured API responses are in the playwright-diff output folder under
  `<policyDetailsId>-1` (`nhi.png`, `tcas.png`, `diff.png`, `nhi-api/`, `tcas-api/`).

## 1. Tenants: MRP hides Buildings insurance, NHI offers it

- **Example:** policyDetailsId `0503FE0FF7904A4899C471DA352E7BD4`, historyId 1, a tenant renting from a landlord (`RPL01`). Quote
  GUID `3189b295-cec8-470b-b352-4ab196e50bd3`.
  - [Open the NHI quote page](https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=3189b295-cec8-470b-b352-4ab196e50bd3&callmediauser=richard.parker&bid=1066)
  - [Open the MRP quote page](https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=3189b295-cec8-470b-b352-4ab196e50bd3&source=tcas&callmediauser=richard.parker&bid=1066)
- **What you see:** NHI shows a **Buildings insurance** row with an empty **Select** box above **Contents insurance**.
  MRP has no Buildings row, so its page is 109px shorter and everything below moves up (12.09% of pixels changed).
- **Data:** NHI's quote summary has `buildingsIsAllowed: true`; MRP's has `buildingsIsAllowed: false`.
- **Scale:** 102 pages, every one a tenant: 73 rent from a landlord (`RPL01`), 15 from a housing association
  (`RHA01`) and 14 from a local authority (`RLA01`). No owner or mortgaged home lost the row on MRP. Two of the 102 are
  conditional quotes on both sides. Six more tenants have the same flags but are referrals on both sides, which show no
  cover rows (see "Not covered above").
- **Side effect:** because everything on the MRP page moves up, any other difference further down these pages is
  hidden, so they need comparing again once this is settled.
- **Question for pricing and underwriting:** may a tenant buy buildings cover? If not, NHI needs fixing; if so, the
  MRP rating (Policy API or Artemis) does.

## 2. MRP doesn't include Personal possessions and high-risk items, NHI does

- **Example:** policyDetailsId `1A13B1F1243841B4BB2A9DD9340868B3`, historyId 1, a mortgaged home (`MOR01`). Quote GUID
  `b97cc0fb-828c-47f8-a77e-fbbf9f5066f9`.
  - [Open the NHI quote page](https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=b97cc0fb-828c-47f8-a77e-fbbf9f5066f9&callmediauser=richard.parker&bid=1066)
  - [Open the MRP quote page](https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=b97cc0fb-828c-47f8-a77e-fbbf9f5066f9&source=tcas&callmediauser=richard.parker&bid=1066)
- **What you see:** under **Contents insurance**, NHI shows **Personal possessions cover** as £0 with **Edit**, and the
  page ends with **Recalculate your quote**. MRP shows **Personal possessions: Not Included** and ends with
  **Continue**. The pages are the same height, so only 0.07% of pixels changed.
- **Data:** NHI's quote summary has `isHighRiskHighValueItemsAllowed` and `isGeneralValuablesCoveredAllowed` both
  `true`; MRP's has both `false`. The other cover flags agree.
- **Scale:** 10 pages, none of them tenants: 5 owned outright (`OWN01`), 4 mortgaged (`MOR01`) and 1 recorded as
  `ky99`. Where the customer listed items, MRP can also drop them; on policyDetailsId `3763F4DCDDE74265A3F3A024E8CEE3C9`
  it drops a pedal cycle with away-from-home cover. On policyDetailsId `C2E56A616F6A4A2A9D36909501E7AC52` (0.16% of
  pixels changed) no text differs. The same two flags disagree on 113 more pages whose screenshots match (see "Not
  covered above").
- **Question for the rating team:** which answer is right, NHI's or MRP's, and why do their ratings of the same answers
  differ? In Artemis
  both flags come from `ArtemisRiskAllowedCoverv004` (property use, ownership, furnished, unoccupied).

## 3. Home owner: MRP hides Contents insurance, NHI offers it

- **Example:** policyDetailsId `106D1920D02642E2A0F55131BB75ED7D`, historyId 1, a home owned outright (`OWN01`). Quote GUID
  `48d4abbc-6fa2-4c18-b2f2-db7fddcc5fbf`.
  - [Open the NHI quote page](https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=48d4abbc-6fa2-4c18-b2f2-db7fddcc5fbf&callmediauser=richard.parker&bid=1066)
  - [Open the MRP quote page](https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=48d4abbc-6fa2-4c18-b2f2-db7fddcc5fbf&source=tcas&callmediauser=richard.parker&bid=1066)
- **What you see:** NHI shows a **Contents insurance** row with **Add Contents cover**. MRP has no Contents row, so its
  page is 118px shorter (7.52% of pixels changed).
- **Data:** NHI's quote summary has `contentsIsAllowed: true`; MRP's has `contentsIsAllowed: false`. MRP also returns
  the two personal possessions flags in section 2 as `false`.
- **Scale:** this page only.
- **Question:** which answer makes MRP refuse contents cover? Take it to the rating team with section 2.

## 4. MRP shows a £1 buildings sum insured, NHI shows the real amount

- **Example:** policyDetailsId `4230522AFAA2430E97FF8EDFD9A6FF40`, historyId 1, a mortgaged home (`MOR01`), with a
  conditional quote ("here's your conditional quote") on both sides. Quote GUID `9751c32f-f6f8-4346-a7e4-f5d3bb0b7bbe`.
  - [Open the NHI quote page](https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=9751c32f-f6f8-4346-a7e4-f5d3bb0b7bbe&callmediauser=richard.parker&bid=1066)
  - [Open the MRP quote page](https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=9751c32f-f6f8-4346-a7e4-f5d3bb0b7bbe&source=tcas&callmediauser=richard.parker&bid=1066)
- **What you see:** the buildings **Sum insured** is £1,619,862 on NHI and £1 on MRP, in both places it appears
  (including the Full accidental damage column). 0.07% of pixels changed.
- **Data:** NHI's quote summary has `buildingsSumInsured: 1619862.68`; MRP's has `1619862.675`, three decimal places.
  The MRP quote page's currency formatting appears to fail on the third decimal place; this is not confirmed in the code.
  MRP also returns the two personal possessions flags in section 2 as `false`.
- **Scale:** this page only.
- **Question:** should QuoteJourneyService round the sum insured to two decimal places, should the MRP quote
  page's formatting cope with more, or both?

## Not covered above

Every page below was captured between 13:33 and 14:33 UTC on 2026-10-21, with both end points recorded. Each is
historyId 1.

- **Six tenants are referrals on both sides, so the Buildings row cannot show.** All six rent from a landlord
  (`RPL01`). NHI and MRP both end on an estimated quote headed **We need to double check a few details with you**,
  which shows the price but no cover rows, so the screenshots match. MRP's response has `buildingsIsAllowed: false`
  and NHI's `true`, as in section 1:
  - policyDetailsId `1F024FF8D7FE4BBEAB4CFA408373AB1B`, quote GUID `0b9ab373-b4d7-41c8-902f-e82460e1fa74`
  - policyDetailsId `295B10C2AA1F4A95825A153FC7BFF86D`, quote GUID `9903d5ed-15d1-4af0-8352-0fac90e5655e`
  - policyDetailsId `733AB9BECBD94620BBBAC05DCE2945E7`, quote GUID `2ebaffa1-ab71-489c-aad3-2b9ca72e9a8c`
  - policyDetailsId `BB8AF0639DF747C0A3B1E944B3B2A4F0`, quote GUID `7f26adaf-1c26-4835-845d-53bac5c86e5f`
  - policyDetailsId `C34C0FE51091491D9A6EAE707B4CAD9A`, quote GUID `ad27133b-1df8-4e5f-b3da-e41a99b861cd`
  - policyDetailsId `DFF53EF0C0F042C496DBBB1141EFB12E`, quote GUID `2208a839-f6f6-41ba-a663-c465a19dddb0`
- **113 pages have section 2's flags but matching screenshots.** MRP's response has
  `isHighRiskHighValueItemsAllowed` and `isGeneralValuablesCoveredAllowed` both `false` and NHI's both `true`, yet no
  pixel differs. 110 are quotes on both sides and 3 are referrals. By ownership: 66 owned outright (`OWN01`), 35
  mortgaged (`MOR01`), 7 recorded as `ky99` and 5 as `SHA01`. 31 include contents cover (for example policyDetailsId
  `01475A462B804356B72AFD2C0417EC01`, quote GUID `6afa5fc4-cfd2-4404-ad84-56400ab24a3a`, with £2,000), and 82 have
  none.
  - **Question for the quote page team:** why does the page show section 2's difference on some quotes with contents
    cover and not on these 31?
  - **The 3 referrals also disagree on the buildings sum insured:** NHI's quote summary has `buildingsSumInsured: 0`,
    MRP's `1772255.1` on policyDetailsId `48392BB4773547D9B1FC1CE765A24C6E` (quote GUID
    `4881b2cf-8b71-4a4a-a9d5-6140f6e4321d`) and `1000000` on policyDetailsId `A5D536B097834FC4831149F4DBE9EB61`
    (quote GUID `7c3ca7c7-7ed3-416c-b529-f30e2396aa05`) and `FE0624B605A24CE08D6FC22BEC82A62A` (quote GUID
    `2928687a-696d-45c8-b068-42f1ac46af54`).
  - **Every page:** listed in [Pages with section 2's flags and matching screenshots](#pages-with-section-2s-flags-and-matching-screenshots) at the end.
- **Two earlier failures now compare as identical:**
  - policyDetailsId `44A07F19086C44C7A9DEA20DA8DB4B20` (quote GUID `eccbd5b8-7969-4f0a-a3c8-3117ddd68379`), one of the
    113 above.
  - policyDetailsId `3831A3A00C88465DB46341EC0BEB48D7` (quote GUID `6e9f70f2-2c0f-4e18-9862-a0221b5d4888`). Its NHI
    quote summary was not saved, so its cover flags cannot be compared.
- **Rendering noise ([open issue 12](open-issues.md)) is gone:** none of the three pages that differed only in how NHI
  and MRP render differs now.
  - policyDetailsId `BB52A54C361C4A8B9BA9227AED7379A5` (quote GUID `463bfebe-c8d3-4b26-962f-970f0ce524ce`): identical
    quotes, every flag agreeing.
  - policyDetailsId `F04BDA6BBD0E497299E21DCF1099902F` (quote GUID `a3626fc0-ca13-4555-854f-14c5c55bc7b7`): identical
    quotes, one of the 113 above.
  - policyDetailsId `855FF5724E9A48DCA0040D55C2652428` (quote GUID `b008ebc4-dfdd-451c-a275-7328fec90797`): now a
    referral on both sides, every flag agreeing.
- **Not investigated here:**
  - 17 failed captures: 10 have no saved MRP file, which mrp-and-quote's fetch did not retrieve, and 7 fail in NHI's
    journey (3 time out ticking **You** under who lives at the property, 2 do not reach the quote within 5 clicks, 1
    is missing an answer on cover details, and 1 is a thatched property that NHI will not quote online).
  - 995 identical pages from the runs of 20 and 21 October, captured before end points were recorded; 560 of them have
    no NHI quote summary saved. Run them again to check them as above.

### Running these pages again

To compare a page again, run playwright-diff's `quote-page` command from the project folder with the **policyDetailsId** (the 32-character ID, not the quote GUID) and its historyId:

```powershell
npm run quote-page -- <policyDetailsId> <historyId>
```

The quote GUID isn't needed: playwright-diff finds it from the policy's saved MRP file (`<policyDetailsId>-1-mrp.json`) and
`quote-guid-mapping.json`. If NHI
can't price the quote it opened, playwright-diff asks for a replacement quote GUID and saves it in the mapping, so the
new comparison may open a different quote GUID from the one listed here. Run
`npm run summarise differences` afterwards to see whether the page now differs.

## Pages with section 2's flags and matching screenshots

The 113 pages in "Not covered above" where MRP's response has `isHighRiskHighValueItemsAllowed` and
`isGeneralValuablesCoveredAllowed` both `false` and NHI's both `true`, but no pixel differs. Each is historyId 1.

- policyDetailsId `00DD15DBC34640879634698B07006ACB`, quote GUID `8e8efae4-7cee-48f9-8705-d03bfcaa384a`: `MOR01`, no contents cover
- policyDetailsId `01475A462B804356B72AFD2C0417EC01`, quote GUID `6afa5fc4-cfd2-4404-ad84-56400ab24a3a`: `OWN01`, contents £2,000
- policyDetailsId `046B8237FC8247E2AF8E169320BFEA84`, quote GUID `11b6b526-c2b5-4463-be0c-71ccd7160a6d`: `OWN01`, contents £50,000
- policyDetailsId `0BB5278008B94246A04C293DCF440653`, quote GUID `7d2e87bb-bc5b-4696-a4c9-d57d91d15ef7`: `OWN01`, no contents cover
- policyDetailsId `11A082624AF44F8BB7E0A126CE698DD7`, quote GUID `5a1b092a-2d3c-4e51-80df-34546d28be6c`: `OWN01`, no contents cover
- policyDetailsId `156E3E27080A4B20B203C3C4040891B5`, quote GUID `d6678a19-f157-4119-bfcb-f19d2ee61783`: `OWN01`, no contents cover
- policyDetailsId `15B616E5150D47D0943C08C70B364EE4`, quote GUID `5a8565fc-d40b-40d8-b23b-f41fff75d301`: `MOR01`, no contents cover
- policyDetailsId `1B55513AE91D40DE96CD8B1C08C79569`, quote GUID `7a007606-aeca-4275-8aed-aca5f2e50c47`: `MOR01`, no contents cover
- policyDetailsId `1C988256836840F6A56549BD1B4BAFFD`, quote GUID `a6fb785d-d7b9-4c50-9ff6-97e05e38c918`: `MOR01`, no contents cover
- policyDetailsId `1E63A41352FA4F20AF691D4957CAC20C`, quote GUID `4127a45d-248d-4b21-b300-72718aad441d`: `MOR01`, no contents cover
- policyDetailsId `1EA13C663B3C459A82736CEBB22DF9E8`, quote GUID `63f07823-982b-45cc-8fdf-aff58d64f52d`: `OWN01`, contents £50,000
- policyDetailsId `2009BC8AA7F84E21BC0A40D522481E9F`, quote GUID `69adee93-dbf8-4361-85e0-fa1d9442871e`: `SHA01`, no contents cover
- policyDetailsId `24CB8A8EEEC84357BFBEE638DBC61805`, quote GUID `68e4da3f-2f8d-4365-a7b0-bafe5c1b6232`: `OWN01`, no contents cover
- policyDetailsId `265850751A7C49008717037EF2737F47`, quote GUID `341c3953-44d6-4aab-87f8-63f3757c654c`: `MOR01`, no contents cover
- policyDetailsId `26F6CF97931F452B90A06605D3EE7B3A`, quote GUID `99a304f0-d71b-44df-9d34-3c7af9dc53e2`: `OWN01`, no contents cover
- policyDetailsId `27DD9FC7626B494B9934BBA407E22D84`, quote GUID `62bff2b5-c9d6-4c55-9426-2f1b98d7fad3`: `ky99`, no contents cover
- policyDetailsId `287DB0EB1E9C424398EE074064DB6409`, quote GUID `26511369-adfb-40e2-9a93-b74b2ae7f89e`: `MOR01`, no contents cover
- policyDetailsId `2890AD71985D4DEEAF20611E33CFB839`, quote GUID `eec6b20a-8a5b-4ed6-8293-0ecc70599585`: `OWN01`, no contents cover
- policyDetailsId `2911857ED9934BAF862BCCBB850887BD`, quote GUID `f7bdde53-e88c-491e-bb40-f257437fc53f`: `OWN01`, contents £50,000
- policyDetailsId `323B3C1BB0D9423EADD80A5E76C6B9A6`, quote GUID `8914c660-9955-4dee-8b68-24249198e5c3`: `ky99`, contents £5,000
- policyDetailsId `3410CA6038444FB98C5B9D086DCB4DA8`, quote GUID `d2952e59-ee8b-4456-a23e-817036354143`: `MOR01`, contents £10,000
- policyDetailsId `37FE4C83D6F44A2AB02D7D38EB58916D`, quote GUID `67f987b7-467e-4f13-9a18-70300a1a5ecb`: `MOR01`, no contents cover
- policyDetailsId `38365C02D7AD4BB7BB08B4A6690CA176`, quote GUID `827e4377-5f75-4813-870f-7b056c816e0b`: `MOR01`, no contents cover
- policyDetailsId `38C0D41FF2D64386A7BE083541C93DC9`, quote GUID `23d598b4-4cc3-4079-a0bd-60f464f0f481`: `OWN01`, no contents cover
- policyDetailsId `3A08519E46CC4C8C93EA075F5819784C`, quote GUID `bd3904fd-c1f7-453f-b3bf-2bb09502bd48`: `OWN01`, no contents cover
- policyDetailsId `3BEF1E0E30484172926F1A6D4281B320`, quote GUID `0539684a-55f5-41aa-bb02-cc8c2c0448ad`: `MOR01`, no contents cover
- policyDetailsId `42A3D25495ED4A75B02B3E258A6B7D32`, quote GUID `fa05c320-d2d9-424e-ad74-da41df09a429`: `MOR01`, no contents cover
- policyDetailsId `42EE20B02DE94CECAFD26CEA17BCEBA4`, quote GUID `0a44707c-9526-49f6-91f2-71f82ad15080`: `OWN01`, no contents cover
- policyDetailsId `4415B76B94464726908A3BE1160D8918`, quote GUID `71842f78-0888-443f-a2bb-dca4adb993b3`: `MOR01`, no contents cover
- policyDetailsId `44A07F19086C44C7A9DEA20DA8DB4B20`, quote GUID `eccbd5b8-7969-4f0a-a3c8-3117ddd68379`: `OWN01`, no contents cover
- policyDetailsId `44BF6A393F754C0690FADCCA553538CF`, quote GUID `5e089553-900c-4083-9115-920ff026b4b8`: `MOR01`, no contents cover
- policyDetailsId `48392BB4773547D9B1FC1CE765A24C6E`, quote GUID `4881b2cf-8b71-4a4a-a9d5-6140f6e4321d`: `MOR01`, no contents cover, referred on both sides
- policyDetailsId `4A1A4D72DF134D52B02607E87DF8183F`, quote GUID `fada12b3-2dec-470a-82e0-d53442059d01`: `MOR01`, no contents cover
- policyDetailsId `4A2B5ED460EF494F858FC939CA2FE720`, quote GUID `554232e2-6f99-40f6-81ab-7bf0a22ceb80`: `OWN01`, no contents cover
- policyDetailsId `4ED8BBCFF8354D39A89457DA75D06062`, quote GUID `36e0bda6-d0e4-475e-bef4-1b737b6268fe`: `MOR01`, no contents cover
- policyDetailsId `4F52476AA48244408DC153CFB4CC5552`, quote GUID `943e133d-f12d-4a96-9285-493598110252`: `OWN01`, no contents cover
- policyDetailsId `51009D07DD0D4C7A825388FA528471D0`, quote GUID `c8d5a842-8b02-4821-a6d6-ca328c75afd3`: `OWN01`, no contents cover
- policyDetailsId `58BDF527208E4D28B48357A52CD256B3`, quote GUID `454964b9-2d8f-4fe3-9991-a87ab06dd88b`: `OWN01`, no contents cover
- policyDetailsId `58C595F4EB714FE1ABE9B2EC8312F0BC`, quote GUID `00ab56c3-328f-4409-b5dc-cb560e334209`: `SHA01`, no contents cover
- policyDetailsId `5C69AE8FE3F5416C9311097897BF19F2`, quote GUID `91ec8977-5a25-46ce-902d-28217994fe0d`: `MOR01`, contents £5,000
- policyDetailsId `5D4DD3B7E60F40228B8EC219A0C52C91`, quote GUID `605063c7-489b-4101-9932-2c256802a175`: `OWN01`, no contents cover
- policyDetailsId `6199F34A98F24F5FA8758036D1D24083`, quote GUID `bd4584f4-0dd6-4f2d-b091-93b7ae48b443`: `OWN01`, no contents cover
- policyDetailsId `6251C4AC45C240F28EAEB792748302AD`, quote GUID `21a17906-f8d4-4622-8ea5-dc5727b190d0`: `OWN01`, no contents cover
- policyDetailsId `627F0C5F65E44452AAF6171948AF14F9`, quote GUID `9da9f06c-7e8b-4ea7-91f4-aa446a3c5ed2`: `OWN01`, no contents cover
- policyDetailsId `6390D626E89A44B9A1CA5D6E5E0960F1`, quote GUID `21f58bc1-af50-4fd7-9b05-a524f6bd64b6`: `OWN01`, no contents cover
- policyDetailsId `67DF40A0950B417BA9B7D0464F496511`, quote GUID `a48f9c28-6caa-4f43-a445-be38f52595b2`: `OWN01`, contents £25,000
- policyDetailsId `67F74AC920D54E8CB2C1CF463CD990C3`, quote GUID `a994c7b1-b548-4a6d-b0a8-2e6c572df436`: `MOR01`, contents £30,000
- policyDetailsId `6C68B0B7C5B64073B55345E404646C66`, quote GUID `8a420f25-e85e-43fd-a9e8-f3a85e956292`: `ky99`, contents £10,000
- policyDetailsId `7181C47A5E194B7AB9890A7C60B55125`, quote GUID `a880b652-f773-4ded-b626-36b4b2a3026d`: `OWN01`, contents £3,000
- policyDetailsId `76CA7CFE2ACC444893200C3369A3F72E`, quote GUID `9a4f0d82-162f-4210-a6f0-bcdbc2e30474`: `MOR01`, no contents cover
- policyDetailsId `7757B90D629A45AFA5695142557E9A94`, quote GUID `e0dfa911-046d-4af8-829c-eb829f24126f`: `OWN01`, no contents cover
- policyDetailsId `77FC32F83C1744ECA5B77A3C80595E4B`, quote GUID `988cec39-2c9a-48a5-b61c-0125ec418935`: `OWN01`, no contents cover
- policyDetailsId `798C2A8CF57746FDA251052DBFA66327`, quote GUID `6336e75e-967b-4d9f-815b-eacb9230c2ce`: `OWN01`, contents £500
- policyDetailsId `7AD859AED8C2425CBBDBA2E3AB7DEA15`, quote GUID `af3e1179-8e42-47dc-aa22-a5b285e2596e`: `OWN01`, contents £30,000
- policyDetailsId `7B3DD058163D4AFE97D87C0F047BD178`, quote GUID `5a38e42d-6f91-4058-b3ec-643cd3fcf6d7`: `OWN01`, no contents cover
- policyDetailsId `834C2A72740A4D39B624C84A008238C0`, quote GUID `bf435020-83a0-4fd3-b9b9-c6da7b92714a`: `OWN01`, no contents cover
- policyDetailsId `874019E0F273477283405C760A1F7495`, quote GUID `5d490adb-3c0d-48e1-9fe9-95fb7d5688cd`: `MOR01`, contents £20,000
- policyDetailsId `8A70A85164A94F5C98C0C07A6EAE5E9B`, quote GUID `68191071-9c00-40d6-9ccb-b7d26e70d775`: `ky99`, no contents cover
- policyDetailsId `8C44112DA86F44469F4D3C6139711D3A`, quote GUID `b8f7d236-1a4a-45bf-aa03-642d3e13ccc7`: `MOR01`, no contents cover
- policyDetailsId `8DC2B8026D354702B42BC6221DAE913A`, quote GUID `1b72ac5d-fc61-4065-bde8-834674cb43ad`: `ky99`, contents £30,000
- policyDetailsId `8EC25F00B4674C8AB6B8EDE700B36E43`, quote GUID `5298b4f4-0b43-4248-8c14-5c73873d83e6`: `OWN01`, no contents cover
- policyDetailsId `90160F8EE80943AEB4BBCDB7F0151F3C`, quote GUID `3b337d3a-4748-4aa5-bef5-6f9aaf62e22f`: `OWN01`, no contents cover
- policyDetailsId `94B3603B4FD14CE3B26BBF2129958CE9`, quote GUID `74923b3b-9cba-43a8-b2fe-66a237f1b338`: `OWN01`, contents £3,000
- policyDetailsId `94DFB83DA84244F4AE67CEDF1109F895`, quote GUID `64fcf568-d832-4e68-b026-c38b303e5109`: `SHA01`, no contents cover
- policyDetailsId `9C0D78C419D445568BB6D78735FEA80B`, quote GUID `d9798ed1-9ca2-402a-857f-a6991ceeaa36`: `MOR01`, no contents cover
- policyDetailsId `9DD82343DFCF4C8898C06111C4028D64`, quote GUID `182b4f21-9453-466f-a8d9-b069bdea1bc8`: `OWN01`, no contents cover
- policyDetailsId `9E8CE4A9EE40454DB1DD91D9BCEFCE70`, quote GUID `2735611a-b849-465e-a231-4851bdfa8e11`: `OWN01`, contents £20,000
- policyDetailsId `A16326504DF24BA4BCFF7025CD6B56D3`, quote GUID `16a0c25e-477d-49fa-8cb0-b526595a19d8`: `OWN01`, no contents cover
- policyDetailsId `A5D536B097834FC4831149F4DBE9EB61`, quote GUID `7c3ca7c7-7ed3-416c-b529-f30e2396aa05`: `MOR01`, no contents cover, referred on both sides
- policyDetailsId `A6AB1CE0309C41CD83D2006AAC9D051D`, quote GUID `98c32ca7-ce5d-41f5-b5f0-c9b226f501d3`: `OWN01`, contents £1,000
- policyDetailsId `A93418F2E1FD4CE0B493E4548088F6B1`, quote GUID `689f1404-47d4-4559-b830-df8f22d69376`: `OWN01`, contents £20,000
- policyDetailsId `AA43BDDDF5314738A3DCCC62D8B8F0D4`, quote GUID `2f3c605e-d8b7-430f-a095-07fed9408c9f`: `ky99`, no contents cover
- policyDetailsId `AC46A23B21F948A48B821AB3A4FDDEA9`, quote GUID `21de8ff3-3d42-47e6-ade9-3d6a0798a4bd`: `OWN01`, contents £10,000
- policyDetailsId `B0195B3689114F28BF7FA2A55426090D`, quote GUID `c0e3b01d-451a-4a17-8ffd-dd96cffc0bda`: `OWN01`, no contents cover
- policyDetailsId `B124E3BC0EC8491F9B901D65A6FCF3F9`, quote GUID `91865cc4-2f03-4950-90f4-8364ea941214`: `MOR01`, contents £2,000
- policyDetailsId `B30FF496DF26455A82BE7EA81AF397E4`, quote GUID `9acfffdd-43a9-43a3-b230-36a45813d8c4`: `OWN01`, no contents cover
- policyDetailsId `B60051D275CC4903BD163C35794AEE06`, quote GUID `cf57a6dc-ef39-4d6c-9449-97e63f33e4fe`: `MOR01`, no contents cover
- policyDetailsId `B657CB6301DE4AA4A0B519698570EC8A`, quote GUID `139ef22e-5d62-436b-b38e-8457cffd9298`: `OWN01`, no contents cover
- policyDetailsId `B7097F5364A342DEB568E627F2EE8D77`, quote GUID `aded4477-334b-4c84-98fa-48d5cca5cb82`: `OWN01`, no contents cover
- policyDetailsId `B76A588E84484579A93F5319A250EE5E`, quote GUID `662ca4b9-15cf-42e4-87a5-ee3ba67382a0`: `OWN01`, no contents cover
- policyDetailsId `B7E8846F7AC84B038A7CF995F421BC03`, quote GUID `9524ae6a-fd4b-49e3-850b-bb6d43174805`: `OWN01`, contents £1,000
- policyDetailsId `B9A028397FA04527AA5F83C39C9DA69E`, quote GUID `4b4a59cf-69cb-4173-bbc3-ce700bdfcd02`: `MOR01`, contents £40,000
- policyDetailsId `BDA3D513F0114691B43A10B3731618B6`, quote GUID `56345619-ff3b-4fe1-b1bc-209bd90e9a99`: `MOR01`, no contents cover
- policyDetailsId `BDD8C44923004200985B10E032FC2F1D`, quote GUID `53e3dcf1-98e4-426c-8802-25a76d388a19`: `OWN01`, no contents cover
- policyDetailsId `C0736FBFAB864F9CBDE4598FAF2FC5C0`, quote GUID `31c041af-29d1-4888-868f-af64fb94787b`: `SHA01`, no contents cover
- policyDetailsId `C221795B77E74CAE852AE0903F8ABB66`, quote GUID `9f900101-f192-4ca9-9d25-ce4be37c91e7`: `ky99`, no contents cover
- policyDetailsId `C6B401D4CDC1439CA05E6E6465044861`, quote GUID `5a780ba9-099f-4310-a985-3198836243ac`: `MOR01`, no contents cover
- policyDetailsId `C73FBC3D17CE422D8AF0A3EE24BC5628`, quote GUID `1a536961-ef1d-486d-96b4-72ee89edb671`: `OWN01`, contents £5,000
- policyDetailsId `C88D8F1B9A0A455B9120981CB5038320`, quote GUID `e4fb04ca-bed6-493b-a067-0c03f58cad05`: `OWN01`, no contents cover
- policyDetailsId `CB9D661C7DC8425AA2F5BE8321F4CD59`, quote GUID `2a353d5b-9e39-4c41-afe4-88025dcb9731`: `MOR01`, contents £5,000
- policyDetailsId `CDEBE43B4EE54A15830ED749F3126240`, quote GUID `4d223dca-373c-470d-9edd-5e789da9cd60`: `SHA01`, contents £50,000
- policyDetailsId `D2509306ABD5416AAEBFBB5B6DB4AB40`, quote GUID `28368a9a-3251-4692-981a-30bf2d4072bb`: `MOR01`, contents £25,000
- policyDetailsId `D56797951F3245189C1FFC5B423E1070`, quote GUID `a624f83a-3648-4fe9-a89e-56c89b3d0eb1`: `OWN01`, no contents cover
- policyDetailsId `D9633A9C18C643608FDEE7F2D0D810E9`, quote GUID `b0581376-ca35-41d3-8d1c-20a1544767c9`: `OWN01`, no contents cover
- policyDetailsId `D9FD2C678C8F4A5B86250A63BB0FAA89`, quote GUID `b35da70f-5afe-48e4-bc34-3171a378193f`: `OWN01`, no contents cover
- policyDetailsId `DBBB4B77D9504224B56DA581FBA112D8`, quote GUID `0de98c51-02d2-4f9f-90c3-00846d6395d1`: `OWN01`, no contents cover
- policyDetailsId `E02DF0E160274FF995CEFC80D488482B`, quote GUID `8d47f704-de7f-4934-8dfa-ecd36b2e0d40`: `OWN01`, contents £8,000
- policyDetailsId `E1C2C663B238491DB4AF037D94EB2571`, quote GUID `93b44e52-2a90-4d64-9fb2-71d082a3297a`: `OWN01`, no contents cover
- policyDetailsId `E70C9640DA8D4E29A7F05C628226CBEC`, quote GUID `603451b7-f43e-4941-8b07-738b06f4c4c4`: `OWN01`, no contents cover
- policyDetailsId `E99025A4C9514882B19828CC197FB926`, quote GUID `47a52388-6c97-4b02-af13-ac1773219022`: `OWN01`, contents £50,000
- policyDetailsId `EB29DDEBCEED40DDA59CFC6E01610B73`, quote GUID `88020b52-cf25-4fbf-9e99-7a408b626e90`: `OWN01`, no contents cover
- policyDetailsId `F00C60ED99DD45918B294A8F31E494C6`, quote GUID `38fba2a8-1713-4829-a79e-07e827bbdc6c`: `OWN01`, contents £10,000
- policyDetailsId `F04BDA6BBD0E497299E21DCF1099902F`, quote GUID `a3626fc0-ca13-4555-854f-14c5c55bc7b7`: `OWN01`, no contents cover
- policyDetailsId `F1201E2D2AE04EBFA09315638CE5F400`, quote GUID `1beba32e-bb69-47ff-8916-4b4f12ee8442`: `OWN01`, no contents cover
- policyDetailsId `F13FD1A92E884642841D42D04FB2DC9D`, quote GUID `8d252868-768c-4f70-b94d-7a57051b7efd`: `OWN01`, no contents cover
- policyDetailsId `F1F88C8BE23D4E3F8353F698131F68D9`, quote GUID `d8768dfb-beed-4678-9d9b-f1647ed08ad9`: `OWN01`, contents £5,000
- policyDetailsId `F2092C8F1ADC48D4BAEBD2E25A527C36`, quote GUID `a6f98329-f118-4f46-a79f-37ceb4ab735e`: `OWN01`, no contents cover
- policyDetailsId `F2D126F8DB2B49BF941A7339471DFE4B`, quote GUID `4546270f-0198-4330-be4d-d3e682bbb19b`: `MOR01`, no contents cover
- policyDetailsId `F71644AC4AF64A5B8BEE43F35A38DF26`, quote GUID `eef436f1-18ac-4e43-b1db-6d8fb5057443`: `MOR01`, no contents cover
- policyDetailsId `FAC9B10A5C0341A790F9FCF68CB4181E`, quote GUID `785a3441-da2e-439d-84ee-6f3854a2ef2c`: `OWN01`, no contents cover
- policyDetailsId `FC1BB225E78C4AC18295BDEDADCFE916`, quote GUID `30372ac7-14d4-487b-9626-36c229ad7086`: `MOR01`, no contents cover
- policyDetailsId `FC7A32BF0B2A4036BC90CDE338951B18`, quote GUID `1e6c578d-e359-4f14-83a6-4cd509df8eaa`: `MOR01`, no contents cover
- policyDetailsId `FE0624B605A24CE08D6FC22BEC82A62A`, quote GUID `2928687a-696d-45c8-b068-42f1ac46af54`: `OWN01`, no contents cover, referred on both sides
