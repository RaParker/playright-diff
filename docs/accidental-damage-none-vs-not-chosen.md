# Accidental damage: "None" and "not chosen" look the same

**Draft for review by underwriting and compliance before anyone acts on it.**

Decision (2026-10-19), replacing the 2026-10-14 decision to keep showing "None": on **new business**, the accidental
damage level stays unset until the customer answers it and it is submitted through the quote page's overrides. Renewals
and MTAs keep showing "None".

QuoteJourneyService PR 25318 (merged into `feature`) does this without storing anything new. On new business it
clears a "None" level from the answers and the quote result, unless the request's overrides supplied that level. The
stored level is untouched, so the price doesn't change. The reasons below still hold: nothing records that the customer
chose "None". So an NB customer who chose "None" is asked again if the quote is reloaded. That was accepted on
2026-10-19 rather than adding a marker to the policy.

The rest of this note is the original 2026-10-14 write-up, kept for the reasons it gives.

## What you see

On a TCAS quote that started in NHI (seen on policies `718CA449FCFC4A959D99124EDC81EA87` and
`77D5FA3FF40441F28699E5AD6F3F0C8C`), the accidental damage **None** button is:

- **NHI quote page:** not selected (outline button).
- **TCAS quote page after Return to quote:** selected (filled button).

The price is the same either way: "None" and "not chosen" both mean no accidental damage cover. In the playwright-diff
quote-page comparison this is the only remaining difference for 77D5FA3F (0.04% of pixels).

## Why the difference can't be kept

The difference is lost at three points, two of them before TCAS reads the policy:

1. **NHI → Transactor save.** When an NHI quote is saved to Transactor, the policy's accidental damage level
   (`BUILDADLEVEL_ID` / `CONTADLEVEL_ID`) is written as `'None'`. PolicyApiService logs show `cboBuildADLevel=None` and
   `cboContADLevel=None` on 13 Oct, before any TCAS re-quote. The writer is in the legacy .NET NHI code, not the Go or
   TypeScript repositories.
2. **Artemis rating.** Artemis turns an empty or unknown level into `None` before rating (`ArtemisRiskADv013.cs`,
   `Enum.TryParse(...) ? level : CoverLevel.None`). The machine-readable product (MRP) then lists accidental damage in
   the selected cover at quality None, so the MRP can never say "not chosen".
3. **Quote result mapping.** GoPackages PR 22925 (work item #41516, merged 2026-08-03) made the shared `mrp-and-quote`
   mapper (`getAccidentalDamageFromProvisions` in `mapper/coverAndAddOn.go`) report a quality-None selection as the
   level `"None"`; before that it came back as null. The quote page fills the **None** button when the level is
   `"None"` and leaves every button empty when it is null.

The rest of the chain could carry "not chosen": the database column allows NULL, QuoteJourneyService (QJS) keeps an
empty answer apart from a missing one, and the quote page shows no selection for a null level.

## What a fix would have needed

- **Storage:** agree NULL or empty as "not chosen" in `BUILDADLEVEL_ID` / `CONTADLEVEL_ID`. The Go model's `default:0`
  and the Transactor read procedures turn NULL into `'0'`, and no repository shows whether `'0'` is a valid level.
- **QJS:** treat an empty answer as "clear to not chosen", and keep the `BUILACCIDENTAL` / `CONTACCIDENTAL` flags in step
  with the level (documents read the flag; the answer-map path updates the level but never the flag).
- **Quote result:** take the level from the stored policy rather than the MRP, either in QJS or through a new mapper
  option, without undoing what #41516 needed.
- **NHI save:** change the .NET NHI → Transactor writer to leave the level empty when the customer hasn't chosen.
  Without this, policies that start in NHI would still show "None".
- **Existing policies:** already store `'None'` with no record of whether the customer chose it. No code change can
  recover that; only a guess such as "a stored None counts as not chosen".

Rough size: three or four PRs across GoPackages, QJS and QuestionSetQuote, plus separate work on the .NET NHI writer.

## Consequences of keeping "None"

- **Price and cover:** none; both states mean no accidental damage cover.
- **Journey:** the quote page requires an accidental damage choice when cover is selected and levels are available. A
  stored "None" satisfies that check, so on a TCAS re-quote the customer isn't prompted to choose, where NHI would
  prompt them.
- **Records:** the policy says the customer declined accidental damage cover, though they may never have been asked.
  Whether that matters under Treating Customers Fairly is for underwriting and compliance to confirm.

## Related change

QuoteJourneyService PR 25166 treats an empty accidental damage answer (`""`) as not answered: it keeps the policy's
stored level instead of overwriting it with an empty value (which Artemis rated as None and Transactor read back as
`'0'`).

## Not followed up

- The TCAS re-quote at 14:55 on 14 Oct still logged `None`. Either the page posted `None`, or the empty answer was
  dropped on the way to QJS; the request body wasn't captured.
- What #41516 asked for wasn't checked.
