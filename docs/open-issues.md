# Open issues

**Draft for review by the relevant teams before anyone acts on it.** Raised while investigating the NHI and TCAS quote
differences (see [the findings](nhi-tcas-conviction-findings.md)); last updated 2026-10-19.

| #   | Issue                                                    | Status      | Needs                    |
| --- | -------------------------------------------------------- | ----------- | ------------------------ |
| 1   | NHI can no longer price the original quotes              | Unexplained | NHI investigation        |
| 2   | NHI offers buildings cover to local-authority tenants    | Open        | Pricing and underwriting |
| 3   | Accidental damage flag and level can disagree after TCAS | Unverified  | Test, then QJS fix       |
| 4   | TCAS Return to quote drops the joint holder's title      | Fix ready   | Review, merge, deploy    |
| 5   | New business accidental damage pre-selected as "None"    | Fix ready   | Review, merge, deploy    |
| 6   | MRP and NHI disagree on high-risk items cover            | Escalate    | Rating team              |
| 7   | Endorsements are formatted differently on NHI and TCAS   | Open        | Decide format, QSQ fix   |

## 1. NHI can no longer price the original quotes

- **What:** since 14 Oct, NHI's `CalculateQuotePremium` returns 500 for the original MRP quote GUIDs of the two test
  policies (`87f68d27…` for `718CA449FCFC4A959D99124EDC81EA87`, `11c88e9b…` for `77D5FA3FF40441F28699E5AD6F3F0C8C`). NHI
  priced the same GUIDs on 13 Oct.
- **Effect:** the NHI quote page shows Oops for those GUIDs. playwright-diff works around it by requesting a replacement
  quote GUID, so comparisons still run, but against a new NHI quote rather than the original.
- **Unknown:** whether this affects other quotes, and what changed on 14 Oct.
- **Next step:** check NHI's logs for the 500s on those GUIDs.

## 2. NHI offers buildings cover to local-authority tenants

- **What:** for 718CA449 the customer rents from the local authority (`ownershipId` `RLA01`). Artemis returns
  `isBuildingsAllowed: false`, so the TCAS quote page hides the Buildings insurance row after a re-quote. NHI still
  offers buildings cover.
- **Decision so far:** TCAS's behaviour is kept as correct; NHI's is unconfirmed.
- **Detection:** the playwright-diff comparison has no rule hiding this; it shows as a difference. Since TCAS
  replacement captures are now always re-quoted (see the README's "TCAS for a replacement GUID"), it appears on every
  run for an affected policy. On 2026-10-16, 718CA449's NHI quote had `buildingsIsAllowed: true` and its TCAS re-quote
  `false`, and the comparison reported 12.33% of pixels changed (the TCAS page is shorter without the row).
- **Next step:** pricing and underwriting to confirm whether a local-authority tenant may buy buildings cover; if not,
  NHI needs fixing.

## 3. Accidental damage flag and level can disagree after a TCAS re-quote

- **What:** the policy stores accidental damage twice for each of buildings and contents: a level (`BUILDADLEVEL_ID` /
  `CONTADLEVEL_ID`: None, Basic, Full) and a cover flag (`BUILACCIDENTAL` / `CONTACCIDENTAL`).
  - QuoteJourneyService's answer-map path (`mapper/quoteJourneyToPolicy.go`, `setQuotePage`) updates the level but never
    the flag. TCAS's **Return to quote** (`POST /api/save-details` with `source=tcas`) uses this path.
  - The Policy API's override path (`service/setPolicyAddOnsAndExcesses.go`) sets both: flag false for None, true
    otherwise.
  - Policy documents read the flag, not the level (PolicyLibraryService `Hp2DocumentDataService.cs`).
- **Possible effect:** a customer who picks Basic or Full accidental damage on the TCAS quote page could have the level
  saved with the flag still false, and documents that say they have no accidental damage cover. The reverse (None with
  the flag still true) is also possible.
- **Status:** found by reading the code; not reproduced.
- **Next step:** change the level on a TCAS quote page, save, and compare the stored flag and level. If they disagree,
  set the flag from the level in QuoteJourneyService's answer-map path, as the Policy API overrides do.

## 4. TCAS Return to quote drops the joint policy holder's title

- **What:** on 3C053A54 (2026-10-19), the TCAS quote page showed the joint policy holder without their title ("Mr.").
  The NHI page showed it. The title answer (`jointNamesTitle`) was the same in every request on both sides.
- **Cause:** after `POST /api/save-details` with `source=tcas`, QuoteJourneyService rebuilds the joint holders from the
  answers. It sets only `TitleId`, not the preloaded `ListTitle`. GoPackages' mrp-and-quote mapper
  (`getJointPolicyHolders`) read the title from `ListTitle`, so the summary came back with `title: 0` and
  `titleText: ""`.
- **Fix:** GoPackages branch `fix/joint-policyholder-title` reads `TitleId` (mrp-and-quote `0.0.515-alpha`), and
  QuoteJourneyService branch `fix/nb-accidental-damage-unset` picks it up.
- **Next step:** review and merge both branches into `feature`, then deploy QuoteJourneyService and re-run the
  comparison for 3C053A54.

## 5. New business accidental damage pre-selected as "None"

- **What:** on a TCAS quote of a policy that started in NHI, the accidental damage **None** button is filled where NHI
  leaves it empty. This happened on 3C053A54 (2026-10-19) as well as the two policies in
  [the write-up](accidental-damage-none-vs-not-chosen.md).
- **Decision (2026-10-19):** on new business, the level stays unset until the customer answers it through the overrides.
  Renewals and MTAs keep "None". This replaces the 2026-10-14 decision to keep showing "None".
- **Fix:** QuoteJourneyService branch `fix/nb-accidental-damage-unset`. The write-up has the details and the one known
  limitation.
- **Next step:** as for issue 4. Underwriting and compliance should also confirm that asking again after a reload is
  acceptable.

## 6. MRP and NHI disagree on high-risk items cover

- **What:** on `3763F4DCDDE74265A3F3A024E8CEE3C9` (2026-10-19), the TCAS quote page dropped a £2,000 pedal cycle with
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
- **Why TCAS drops the item:** GoPackages' mrp-and-quote mapper (`getListedItems`) sets each item's `includeInQuote`
  from the MRP's `isHighRiskItemsAllowed`, so TCAS follows the stored rating correctly.
- **Next step:** escalate to the rating team: which answer is right, and why do the two ratings of one policy differ?
  In Artemis both flags come from `ArtemisRiskAllowedCoverv004` (property use, ownership, furnished, unoccupied).

## 7. Endorsements are formatted differently on NHI and TCAS

- **What:** on `E9BC79F1468E45E896BC1182F2F35B85` (2026-10-19), the `BIKESEC` endorsement is one paragraph on NHI and
  two on TCAS, which moves everything below it down a line.
- **Cause:** the wording is the same: the MRP's `endorsementHtml` and NHI's `CalculateQuotePremium` both have `</p><p>`
  between the sentences and `class="definition"` on defined terms. QuestionSetQuote's quote summary (NHI) runs every
  endorsement through `convertSpecificTermsItemsUsingMarkdown` (`server/nhiIntegration/getQuoteSummary.ts`), which
  sanitises the HTML: it drops the classes and merges the paragraphs. The TCAS `save-details` response shows the HTML
  as QuoteJourneyService returns it.
- **Not a fix:** showing the MRP's `endorsementText` instead would not match either side. It is plain text with
  `\r\n` line breaks and `•` bullets, so as HTML its paragraphs and list would collapse into one block.
- **Next step:** decide which formatting is wanted (NHI's sanitised version loses the definition styling), then apply
  the same processing on both paths in QuestionSetQuote.

## Closed

- **Accidental damage "None" vs not chosen:** reopened as issue 5 after the 2026-10-19 decision.
- **Conviction offence arriving blank:** fixed by PolicyAPIService PR 25168 and QuoteJourneyService PR 25170.
