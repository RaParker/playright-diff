# Open issues

**Draft for review by the relevant teams before anyone acts on it.** Raised while investigating the NHI and TCAS quote
differences (see [the findings](nhi-tcas-conviction-findings.md)); last updated 2026-10-16.

| #   | Issue                                                    | Status      | Needs                    |
| --- | -------------------------------------------------------- | ----------- | ------------------------ |
| 1   | NHI can no longer price the original quotes              | Unexplained | NHI investigation        |
| 2   | NHI offers buildings cover to local-authority tenants    | Open        | Pricing and underwriting |
| 3   | Accidental damage flag and level can disagree after TCAS | Unverified  | Test, then QJS fix       |

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

## Closed

- **Accidental damage "None" vs not chosen:** kept as "None";
  see [the write-up](accidental-damage-none-vs-not-chosen.md).
- **Conviction offence arriving blank:** fixed by PolicyAPIService PR 25168 and QuoteJourneyService PR 25170.
