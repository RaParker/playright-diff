# TCAS re-quote drops the admin fee and add-ons

**Draft for review by pricing, underwriting and compliance before anyone acts on it.**

Environment: dev / feature-dev. Checked 2026-10-14 08:58–09:30 UTC. Policies `718CA449FCFC4A959D99124EDC81EA87`
and `77D5FA3FF40441F28699E5AD6F3F0C8C`, history ID 1; each has an unspent criminal conviction in TCAS.

## Finding

The same quote is priced three ways. The third, a re-quote made by the TCAS quote page (`source=tcas`) when an answer
is changed, has no admin fee, no full Home Emergency, no full Legal Expenses and no KeyProtect, and the NHI quote
engine cannot price it.

| 718CA449                              | Quote GUID | Yearly  | Admin fee | Full HE / full LE / KeyProtect |
| ------------------------------------- | ---------- | ------- | --------- | ------------------------------ |
| TCAS MRP (Policy API)                 | `87f68d27` | £117.06 | £50       | offered                        |
| NHI quote of the same GUID (13 Oct)   | `87f68d27` | £117.06 | £50       | offered                        |
| NHI quote of the replacement GUID     | `5397eb2e` | £164.11 | £50       | offered                        |
| TCAS quote summary of the replacement | `5397eb2e` | £164.11 | £50       | offered                        |
| TCAS re-quote after an answer change  | `25b9d2d3` | £74.56  | £0        | not available                  |

77D5FA3F gives £74.73, £74.73, £137.63, £137.62 and £53.44 down the same rows.

## Reproduce

All URLs are for 718CA449. Substitute the 77D5FA3F values from [Values for 77D5FA3F](#values-for-77d5fa3f).

### 1. TCAS policy and MRP

```text
GET https://wkservices-dev.avantiagroup.co.uk/policyapiservice/api/policy/718CA449FCFC4A959D99124EDC81EA87/1
→ 200 userEligible.criminalConviction: true,
      userEligible.userEligiblePersonDetail[0].userEligibleIncidentDetail[0].convictionTypeId: "MPP101"

GET https://wkservices-dev.avantiagroup.co.uk/policyapiservice/api/policy/718CA449FCFC4A959D99124EDC81EA87/1/mrp
→ 200 machineReadableProducts[0].premiumInfo: {"grossPremium":117.06,"adminFee":50}
      machineReadableProducts[0].addOnInfo.addOns: DASHEBAS (selected, £0.01), DASHESTD £52.99, DASHENS £52.99,
      DASLEBAS (selected, £0.01), DASLESTD £36.99, DASLENS £36.99, 3NAC4P35 KeyProtect (selected, £8.50)
```

Each MRP call returns a new `artemisQuoteGuid`. The one saved on 12 Oct, and used below, is
`87f68d27-e6aa-423a-9e9d-e5b9490549b6`.

### 2. NHI quote of the original GUID

```text
GET https://quote-dev.homeprotect.co.uk/api/Quote/CalculateQuotePremium?quoteGuid=87f68d27-e6aa-423a-9e9d-e5b9490549b6
→ 13 Oct: 200 QuoteAmounts {"YearlyAmount":117.06,"AdminFee":50},
          AddOns {"IsFullHomeEmergencyAvailable":true,"IsFullLegalExpensesAvailable":true,"IsLostKeyAvailable":true}
→ 14 Oct: 500 "Check previous unhandled Web API exception for full details."
```

Because of the 500, the NHI quote page
<https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=87f68d27-e6aa-423a-9e9d-e5b9490549b6&callmediauser=richard.parker&bid=1066>
shows Oops (`GET /api/quote-summary/87f68d27-e6aa-423a-9e9d-e5b9490549b6/user/richard.parker` → 400 wrapping the 500).

### 3. Replacement quote GUID

```text
POST https://quotes-feature-dev.homeprotect.co.uk/api/nhi/quote-guid?agentId=richard.parker&branchCode=1066&callMediaUser=richard.parker&policyDetailsId=718CA449FCFC4A959D99124EDC81EA87&historyId=1
     {"coverStartDate":"2026-10-14"}
→ 200 5397eb2e-2005-4ac2-bd88-b98ccd8ae861
```

In this quote the conviction offence answer is empty, so both journeys stop on Household details with "Enter the
criminal conviction that they were convicted of". **Theft** was chosen on both sides.

### 4. NHI journey on the replacement GUID

Open <https://quotes-feature-dev.homeprotect.co.uk/#guid=5397eb2e-2005-4ac2-bd88-b98ccd8ae861,nhi=false>, set the
offence to Theft and continue to the quote.

```text
POST https://quotes-feature-dev.homeprotect.co.uk/api/save-details?getQuoteSummary=true&incrementedSectionId=959154f0-4120-11ea-8d4c-ab6d2f0166c9&totalSectionChanges=1
     answers.metadata: {"quoteGuid":"5397eb2e-…","isJourneyComplete":true,…}   (no source, policyDetailsId or historyId)
→ 200 quoteResult.quoteGuid "5397eb2e-2005-4ac2-bd88-b98ccd8ae861", quoteAmounts {"yearlyAmount":164.11,"adminFee":50},
      addOns {"isFullHomeEmergencyAvailable":true,"isFullLegalExpensesAvailable":true,"isLostKeyAvailable":true}

GET https://quote-dev.homeprotect.co.uk/api/Quote/CalculateQuotePremium?quoteGuid=5397eb2e-2005-4ac2-bd88-b98ccd8ae861
→ 200 QuoteAmounts {"YearlyAmount":164.11,"AdminFee":50}, the same three add-ons available
```

### 5. TCAS quote page on the replacement GUID

Open
<https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=5397eb2e-2005-4ac2-bd88-b98ccd8ae861&source=tcas&callmediauser=richard.parker&bid=1066>.

```text
GET https://quotes-feature-dev.homeprotect.co.uk/api/quote-summary/5397eb2e-2005-4ac2-bd88-b98ccd8ae861/user/richard.parker?source=tcas
→ 200 quoteResult.quoteAmounts {"yearlyAmount":164.11,"adminFee":50}, the same three add-ons available
```

Click **Continue with quote**, set the offence to Theft on Household details, click **Return to quote**.

```text
POST https://quotes-feature-dev.homeprotect.co.uk/api/save-details?getQuoteSummary=true&incrementedSectionId=959154f0-4120-11ea-8d4c-ab6d2f0166c9&totalSectionChanges=1
     answers.metadata: {"source":"tcas","policyDetailsId":"5397EB2E20054AC2BD88B98CCD8AE861","historyId":1,
                        "quoteType":"nb","quotePrice":164.11,"shouldDisplayReturnToQuote":true,…}
→ 200 quoteResult.quoteGuid "25b9d2d3-77af-4f8e-832e-353746ee8887", policyRefNo "RS0958306QP",
      quoteAmounts {"yearlyAmount":74.56,"adminFee":0},
      addOns {"isFullHomeEmergencyAvailable":false,"isFullLegalExpensesAvailable":false,"isLostKeyAvailable":false},
      addOnsNew.home.basic / legal.basic {"isSelected":true,"grossPremium":0.01}, addOnsNew.key.*.isAvailable false,
      configAndInterfaceNew {"useNewSaveRetrieve":true,"homeprotectQuotePageVersion":2}

GET https://quote-dev.homeprotect.co.uk/api/Quote/CalculateQuotePremium?quoteGuid=25b9d2d3-77af-4f8e-832e-353746ee8887
→ 500 "Check previous unhandled Web API exception for full details."
```

The page now shows £74.56 a year and an empty "Select cover upgrades" section.

The playwright-diff command `npm run quote-page -- 718CA449FCFC4A959D99124EDC81EA87 1 --no-ocr` runs steps 2–5 and
saves every `/api/` response.

## Values for 77D5FA3F

- **Conviction type:** `AGG99`
- **Original GUID (MRP, 12 Oct):** `11c88e9b-15a4-48cb-be2d-e9a577232626`. £74.73 and £50 fee; 500 from
  `CalculateQuotePremium` on 14 Oct.
- **Replacement GUID:** `a90ebcff-1517-4b51-8e66-be90e51c5a05`. NHI £137.63, TCAS quote summary £137.62, £50 fee.
- **TCAS re-quote GUID:** `f19e724a-6e1a-4ad0-8a83-57fe860640d5`. £53.44, £0 fee, add-ons not available; 500 from
  `CalculateQuotePremium`.

## Saved responses

Each response is saved with its URL, method, status, request body and response body in
`D:\temp\playright-diff-output\<policy>-1\` (local to the machine that ran it):

- `nhi-api/001-GET-quote-summary-…json`: the 400 in step 2
- `nhi-api/019-POST-save-details.json` (`018` for 77D5FA3F): step 4
- `tcas-api/011-GET-quote-summary-…json`: step 5, quote summary
- `tcas-api/019-POST-save-details.json`: step 5, re-quote

They contain the test policy's personal details and conviction, so share them internally only.

## Questions

1. Why does `save-details` with `source=tcas` create a new quote (new GUID, no admin fee, no full add-ons or
   KeyProtect) instead of updating `5397eb2e`, as the NHI journey does?
2. Why can `CalculateQuotePremium` not price the TCAS re-quote GUIDs, or (since 14 Oct) the original MRP GUIDs?
3. Should conviction types `MPP101` and `AGG99` reach the NHI quote as an offence answer, rather than empty?
