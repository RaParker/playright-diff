# TCAS refuses cover that NHI allows

**Draft for review by the relevant teams before anyone acts on it.** From the playwright-diff run of 2026-10-21 on
feature-dev: 107 of 1,219 quote pages differed between NHI and TCAS, and 102 of those are explained by the two issues
below. They are tracked as [open issues 2 and 6](open-issues.md); the other five pages are open issues 10 to 12.

In both issues the TCAS re-quote and NHI rate the same answers differently and disagree on which cover the customer may
buy. Neither is a display bug: each page shows faithfully what its own rating returned.

## How the comparison builds each quote

Because NHI can no longer price the original quotes (open issue 1), playwright-diff asks Quote Journey for a replacement
quote GUID that carries the TCAS policy's answers (cover start date 2026-10-21) and quotes it through NHI. TCAS then
opens the same GUID and clicks **Return to quote**, which posts the answers to `/api/save-details` and re-prices them
through QuoteJourneyService and the Policy API. The NHI page is NHI's quote summary (`/api/quote-summary/<guid>`); the
TCAS page is what `save-details` returns.

On this run the TCAS quote summary opened by GUID was priced by NHI until **Return to quote** was clicked, so the two
pages matched until the re-quote ([open issue 8](open-issues.md)). QuestionSetQuote PRs 25403 and 25411 fix that: once
they are deployed, the TCAS page shows TCAS's cover as soon as it opens, and the **Return to quote** steps below are no
longer needed. TCAS's own policy quote summary already showed it on first load.

## Tenants lose the Buildings insurance section on TCAS (open issue 2)

- **Pages affected:** 96, every one a tenant:
  - **Rent (from a Landlord)** (`RPL01`): 70
  - **Rent (from Housing Association)** (`RHA01`): 14
  - **Rent (from Local Authority)** (`RLA01`): 12
- **What you see:** NHI shows a **Buildings insurance** row with an empty Select box above Contents insurance. TCAS
  doesn't show the row, so its page is about 109px shorter and everything below moves up.
- **Data:** NHI's quote summary has `buildingsIsAllowed: true`; TCAS's `save-details` response, and TCAS's policy quote
  summary on first load, have `buildingsIsAllowed: false`. No owner or mortgaged policy in the run lost the row.
- **Background:** [open issue 2](open-issues.md) recorded this for `718CA449FCFC4A959D99124EDC81EA87` alone, with TCAS's behaviour kept as
  correct and NHI's unconfirmed. This run shows it applies to every renter.
- **Needs:** pricing and underwriting to confirm whether a tenant may buy buildings cover. If not, NHI is wrong and needs
  fixing; if so, the TCAS rating (Policy API or Artemis) is wrong.
- **Side effect:** the shift hides any other difference further down these 96 pages, so they need comparing again once
  this is settled.

### Scenario: a private tenant

Policy `0503FE0FF7904A4899C471DA352E7BD4`, history 1, answered **Rent (from a Landlord)**. Quote GUID
`3189b295-cec8-470b-b352-4ab196e50bd3`.

1. Open the NHI quote page:\
   <https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=3189b295-cec8-470b-b352-4ab196e50bd3&callmediauser=richard.parker&bid=1066>
2. Click through any summary or assumptions page to the quote. Note the **Buildings insurance** row (not selected)
   above **Contents insurance**.
3. Open the TCAS quote page for the same quote:\
   <https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=3189b295-cec8-470b-b352-4ab196e50bd3&source=tcas&callmediauser=richard.parker&bid=1066>
4. Click through to the quote. Once open issue 8's fix is deployed, there is no **Buildings insurance** row; the page
   starts at **Contents insurance**.
5. Before that fix is deployed, the page still shows the Buildings row (NHI's pricing). Open **Contact details** from the
   timeline and click **Return to quote**; the re-priced quote has no Buildings row.

The same steps work for the other tenancies, for example:

- **Local authority tenant:** policy `040E53264C8B4DB4AE87E69CE58C4A2E`
  - NHI:
    <https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=08833eba-7569-4120-a5ae-66cacddba54b&callmediauser=richard.parker&bid=1066>
  - TCAS:
    <https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=08833eba-7569-4120-a5ae-66cacddba54b&source=tcas&callmediauser=richard.parker&bid=1066>
- **Housing association tenant:** policy `024F72ABDE3C4FF18A56AD3AC920AFAE`
  - NHI:
    <https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=3574bf13-082e-494f-a54e-4aacfd4564f1&callmediauser=richard.parker&bid=1066>
  - TCAS:
    <https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=3574bf13-082e-494f-a54e-4aacfd4564f1&source=tcas&callmediauser=richard.parker&bid=1066>

## Personal possessions and high-risk items not allowed on TCAS (open issue 6)

- **Pages affected:** 6 (owners and mortgaged homes, plus one "Other").
- **What you see:** NHI shows **Personal possessions cover** as an editable £0 amount. TCAS shows **Personal
  possessions: Not Included**. Where the customer listed items:
  - TCAS adds "One or more items you listed can be covered away from the home under our personal possessions cover…"
    and, on `5E9CA3D0E80B4278B4D896612B2CEF52`, "…are covered as standard inside the home…".
  - On `3763F4DCDDE74265A3F3A024E8CEE3C9`, a £2,000 pedal cycle with away-from-home cover is dropped ("You've chosen not
    to specify any items").
  - Some pages show **Recalculate your quote** on NHI where TCAS shows **Continue**.
- **Data:** NHI's quote summary has both `isHighRiskHighValueItemsAllowed` and `isGeneralValuablesCoveredAllowed` set to
  `true`; TCAS's `save-details` response has both `false`. The other cover flags (`buildingsIsAllowed`,
  `contentsIsAllowed`, both accidental damage flags) agree.
- **Background:** [open issue 6](open-issues.md) recorded this for `3763F4DCDDE74265A3F3A024E8CEE3C9`, where the stored MRP and NHI's
  `CalculateQuotePremium` gave different answers for the same policy. In Artemis both flags come from
  `ArtemisRiskAllowedCoverv004` (property use, ownership, furnished, unoccupied). This run adds five more policies.
- **Needs:** the rating team to say which answer is right and why two ratings of the same answers differ.

### Scenario: a mortgaged home

Policy `1A13B1F1243841B4BB2A9DD9340868B3`, history 1, answered **Own (Mortgage)**. Quote GUID
`b97cc0fb-828c-47f8-a77e-fbbf9f5066f9`.

1. Open the NHI quote page:\
   <https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=b97cc0fb-828c-47f8-a77e-fbbf9f5066f9&callmediauser=richard.parker&bid=1066>
2. Click through to the quote. Under **Contents insurance**, **Personal possessions cover** shows £0 with an input.
3. Open the TCAS quote page for the same quote:\
   <https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=b97cc0fb-828c-47f8-a77e-fbbf9f5066f9&source=tcas&callmediauser=richard.parker&bid=1066>
4. Click through to the quote. Once open issue 8's fix is deployed, **Personal possessions** shows **Not Included**.
5. Before that fix is deployed, open **Contact details** from the timeline and click **Return to quote** to see it.

For the dropped pedal cycle, use policy `3763F4DCDDE74265A3F3A024E8CEE3C9` the same way:

- NHI:
  <https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=fb6d3296-7660-4327-87a3-5483950308a3&callmediauser=richard.parker&bid=1066>
- TCAS:
  <https://quotes-feature-dev.homeprotect.co.uk/quotesummary#guid=fb6d3296-7660-4327-87a3-5483950308a3&source=tcas&callmediauser=richard.parker&bid=1066>

## Notes for anyone following the scenarios

- The URLs are feature-dev. `callmediauser=richard.parker` is the agent the comparison ran as; replace it with your own
  username to have the quotes recorded against you.
- Each **Return to quote** re-prices the answers and saves a new quote GUID (listed below as the re-quote GUID). That
  GUID doesn't open in the quote summary, so start from the quote GUID each time.
- The quote GUIDs above were checked on 2026-10-21: both the NHI and TCAS quote summary APIs returned 200 for them.
- Each run's screenshots, crops and captured API responses are in the playwright-diff output folder under
  `<policy ID>-1` (`nhi.png`, `tcas.png`, `diff.png`, `nhi-api/`, `tcas-api/`).

## Every affected quote

Each line gives the policy ID and history, the quote GUID both pages were opened with, and the GUID TCAS's re-quote
saved.

### Open issue 2: Rent (from Housing Association) (`RHA01`) (14)

- `024F72ABDE3C4FF18A56AD3AC920AFAE` (history 1): quote `3574bf13-082e-494f-a54e-4aacfd4564f1`, re-quote `54d95fb9-ab21-4bc9-8554-accffc6bd3b4`
- `0AEDE54DFCB24F049C22B19375941B17` (history 1): quote `42264da0-2d3d-4cf4-82b8-cb739ae44042`, re-quote `d16fe301-ae92-4c56-ad35-f4d8cddc6143`
- `17A7C9C91F854263A39DF7EB87F6A4EE` (history 1): quote `0370ab9d-93eb-4a08-8253-4e251fec3d24`, re-quote `b4dd1073-64e7-4669-ba1e-1deddcac71cd`
- `17C90EFE5855405CB4A9107A661A24B7` (history 1): quote `dcef9235-1935-4d23-b57c-acb4e1b3f92f`, re-quote `0d48c781-0877-4e02-bfcf-86d51877038d`
- `1C95670027A04676BF9F152DE5FFBAB1` (history 1): quote `860f33d2-f737-4111-b632-884ceb8b4cb7`, re-quote `e8e5fb65-7c05-4e10-a30c-61a9a2db2567`
- `298DE4EE063E450CB967FC958C2C880B` (history 1): quote `6aca2cb6-9358-4fc4-bf1b-cc92aebc69c4`, re-quote `d7220620-febb-438b-bbe5-9d34eb140b59`
- `368D6A76AAFE4DB2A387AEBA49A179BA` (history 1): quote `be92283e-b721-4abb-a6c6-97bc6ee435d9`, re-quote `dfe258f5-c713-467b-b1be-1cfb88a00b09`
- `42B62854A4724BA8B72979FA297B0436` (history 1): quote `0e11613c-a2be-4ecc-95b0-84e3f0c8aa42`, re-quote `56bd787c-6f19-4748-b3dd-844d6b89ce81`
- `690D947BED5049DCB801551668944A26` (history 1): quote `2a147b2c-e9cc-46fb-8a8c-30104ec22b85`, re-quote `af3dbbe7-5675-43f6-b121-88f355842319`
- `7111B7F80CF64B6F94C89B608F6AA6A0` (history 1): quote `71aa0820-6aa6-42f8-9ec3-1f1e89d249c3`, re-quote `8ea64c9e-b043-451e-b557-3c0addfc92a9`
- `960E8E7ABA694FBBBB1B546BD939F4BD` (history 1): quote `aceee8fb-65fa-4820-9562-fb1798129160`, re-quote `654febbb-0174-4819-ba3d-b283395ac770`
- `982BB2D8C6414AE8A32B7D1F3207901A` (history 1): quote `3aabef5c-5966-461e-96d0-205fd75b456c`, re-quote `482b7304-79d7-4d09-bea5-cc0ffd80c9dc`
- `AA2686FF4E624FC89544F26ACD322AF4` (history 1): quote `78f36e6e-000e-4035-a389-ed8bd8df3cc2`, re-quote `a44a7cbb-60fe-4085-aa34-d80f0cb9241e`
- `AA79D953DEC74DBA8E8DD1BF62F57CC9` (history 1): quote `267b0c8c-26e9-42e2-9f69-d45f683a85c3`, re-quote `4a96567d-70ae-4b24-a09f-28737da88639`

### Open issue 2: Rent (from a Landlord) (`RPL01`) (70)

- `02986F9663DC4AD694E569D6D8C4CB15` (history 1): quote `63b83814-7b1d-4ca9-8dd5-3f28ec664ab8`, re-quote `5e45cbef-40dc-4bcd-882f-7bf1f2af0288`
- `0503FE0FF7904A4899C471DA352E7BD4` (history 1): quote `3189b295-cec8-470b-b352-4ab196e50bd3`, re-quote `33e754c4-4909-45d5-a191-a0d4892bcbde`
- `052A9307ABE24A4ABB152AAD2D76698A` (history 1): quote `aeba3f40-ef70-4601-821d-5dd6e9ae5216`, re-quote `88377aae-ab9a-43ba-9809-482d706a3939`
- `06D64482AA6B4EFF8A03C662FD3694CE` (history 1): quote `1e7336fb-6161-40f4-b113-6be6226f69be`, re-quote `f20f5ab5-b78d-4474-bde9-a38e7cb3e056`
- `097D2DDB84D94DBCA61DC9799C240262` (history 1): quote `4fd08bc2-f5fe-4eca-bca6-33992a2b5e3e`, re-quote `e758b405-bd36-418e-9992-3b98996e32c3`
- `0EDA8D164DA44E518F597AB6A9FC2BF4` (history 1): quote `9ca111c5-e83a-4dd2-a670-d3da4a384092`, re-quote `23b348b7-bf8d-40eb-be24-aef4806da585`
- `10754454EC6949218060B8617E09BA2F` (history 1): quote `706cecf7-9509-4ab7-9493-b22c5c5d0f06`, re-quote `c2fa951c-d337-40e9-bda4-193f69bbb853`
- `134B7F6E5C7A49EC94D305F7BFA5D407` (history 1): quote `ac2d2d60-2a50-4be8-a74b-23d3c210afa4`, re-quote `b7756ea1-256f-4724-a822-9725e41e59bb`
- `147AAEE77DFB4AE18285C7FE8EF91F39` (history 1): quote `49d860d6-6550-46d2-91c2-2d384c243e07`, re-quote `b14c4ba6-b745-4d9c-a255-c599d0e0c345`
- `1A6BA259E1904BE6AEB7F843E19F2984` (history 1): quote `4c9bb35c-255d-4035-be13-8fe4a5e636f0`, re-quote `6f8c7594-13e3-4168-b8be-ddea6e30a25d`
- `31F3F86369F0495BBCCA7A82A06D66D2` (history 1): quote `3334cd96-c781-4c7e-b5f3-25d9157a1ab5`, re-quote `a062ea57-5aed-4c15-9942-264f5f3da87e`
- `32403E5D79D2495D8750EBF60EC620FF` (history 1): quote `b0004d2e-880c-439d-87ca-c169264a3bec`, re-quote `f91beef3-1b1f-49d8-9ad4-3a6842544fbd`
- `376E76BAB7994B519BC4428036D97418` (history 1): quote `9f283537-b315-47e0-96db-53dbf5eddda0`, re-quote `1dc4eed5-3d88-4d8d-9146-f2833d3644bf`
- `3831A3A00C88465DB46341EC0BEB48D7` (history 1): quote `6e9f70f2-2c0f-4e18-9862-a0221b5d4888`, re-quote `54f7676c-cf4d-4a58-893c-45b085c85f48`
- `384EE01ACA574BAFB78243DB077A9DE3` (history 1): quote `de4e1cbf-e90b-46f2-a6bd-083de1f96c2c`, re-quote `81f7cad0-d5ae-48ea-a44f-efe4bc19690d`
- `3B97712504484D549B44470B016A0491` (history 1): quote `319bc181-a7d0-4706-8df7-265aa7f80e4d`, re-quote `be02efe9-0cdb-42d2-bb2e-685917464415`
- `3F3955DF9D124E5FB1908C00C6978DAF` (history 1): quote `bae733ad-0e4c-4970-8af7-226712579e4b`, re-quote `3bd38b8c-f7af-4e10-b8b3-17579e452c7e`
- `43AAFDF38A0845348DC2DAA3BD50DCB8` (history 1): quote `019aab15-00e5-4695-9745-ab31ffa44b98`, re-quote `44b6dbf5-55a4-4b6a-8772-7134d57e9dde`
- `4D9B216881B2462E8E8AFBCB285C65B6` (history 1): quote `4b147251-37fe-4755-8b9a-367d141f7ce3`, re-quote `2baa6fd8-e0bf-43d4-ab62-36fa72c4879f`
- `521DA79C59714285B4C76EFB315D297D` (history 1): quote `ff44f121-9a4b-4312-a6ef-fb3976ed718c`, re-quote `8b021c72-fc83-4cc1-8122-f96bd312fe93`
- `5274C516C0234334A9E5EB4C724421C9` (history 1): quote `770269c7-83d0-4051-b136-a01357d118ef`, re-quote `4dc31aa6-32ce-467c-9a50-2968eb02e19a`
- `597D621804034ADAA447A306B67BE375` (history 1): quote `4945f1ad-5e04-4af0-88bd-34cea6db1be5`, re-quote `58bf3db5-ea34-4872-b840-191a5c410578`
- `59C150EB908C4C828DB0EA6B7241D142` (history 1): quote `1b5a3f69-41ff-4a2b-9f41-0b587425795c`, re-quote `6cafef53-8319-4c00-824b-c8e05dca9992`
- `60B90F437EFA47CF80CB66B33EFD153E` (history 1): quote `1f0aa05a-e1ec-4f52-a8e5-de2d72f149a1`, re-quote `79149b66-7474-4ebb-9dc8-b339c50068d0`
- `62E0D8219B94438EAC78BB74B41ECF21` (history 1): quote `07d25120-2611-477d-be16-35b3b836db4a`, re-quote `d72b1ab7-7507-4001-9704-1846933a68da`
- `64980782EDCA4D8EB9348E91C2A911DD` (history 1): quote `50f18200-9d82-4324-a24c-0826fc0f1ce4`, re-quote `e044cf48-4f7f-4000-8f72-b141ad84b4bd`
- `6819E30C2058490B8D1D9E25D267B002` (history 1): quote `c6a3bb88-0d98-4d72-9e5e-8787c5e3207f`, re-quote `fe7e3e8c-9775-435c-a5e8-a6b821f1b89e`
- `7026A5834D65442D9131C36BC37A6B51` (history 1): quote `44023d53-cefe-43cb-8fd3-3cc6b9a90eb7`, re-quote `adb07ef7-beb1-42e1-b2bf-9c0f4fd371a5`
- `71474261E3934DB08084C76F6F5CD005` (history 1): quote `d9a4a65f-acc3-4ebd-80ce-6e9b33dc6a9f`, re-quote `583f3afc-bcf4-4d65-85a8-903cee3eb373`
- `71CE33C720CF440CB3E2053900502FC7` (history 1): quote `786d5e1a-54fa-499e-8fbc-fb6023bc08b6`, re-quote `c14e8a12-b832-474b-b222-95cd308412d9`
- `77FEC3B4F8504412ADB6D5B1027AFE75` (history 1): quote `33753549-ffd8-4e6b-a2a7-633fb905de93`, re-quote `5f916e3d-9deb-4418-9a05-b8148394f749`
- `7C2DD25B34E34F6B85F3FF19B8742BE1` (history 1): quote `cb900ade-4a05-4a28-b34f-d66644c76af5`, re-quote `87bb8f50-71e2-498e-8b82-d76a2290accd`
- `7CFA8DDD85CC4DC38A40CDCFDB278329` (history 1): quote `9eccfbf1-2148-4e62-8786-c40ca815554f`, re-quote `99853c72-c9f0-41cd-81a5-4a526017e0f2`
- `7E06AF8AA99F46148F55BC291044A668` (history 1): quote `45fb7d44-01fa-4b03-8d30-273ef16d6c71`, re-quote `a6373ace-71e6-4ab6-9867-1fd8b594fd9f`
- `82FB4D57B628490BB2EE1E30B7C1FDCE` (history 1): quote `f3ed0f6a-db35-41e0-8e2b-9ad279c00052`, re-quote `5554e4af-b165-486b-b16a-a48043676ad0`
- `85193265D7FD48AA84A5F07288CC05BF` (history 1): quote `baf72d32-d374-4b3d-8634-7a2c7da6ce15`, re-quote `934a798f-64e8-42a4-8b14-4d1dea48d2df`
- `88EBC0632043465D9A7FB7FEDCB0BEB5` (history 1): quote `d0344a87-e95a-4af5-b015-8bdbaa0baad6`, re-quote `35cc9f32-0b38-40b4-af88-66e96276ba8e`
- `8CECCA3826524127B94EE1303FFFFC2E` (history 1): quote `1a5b2854-ad3a-4c4b-a4f6-e705ab93ef01`, re-quote `2cba9dba-25a4-4fd4-b9b7-022c7759d4d6`
- `8E014B935D7F45A5AB7C063FF02D5A8C` (history 1): quote `c41a534b-0afc-406b-81f0-8f31e2c5dd27`, re-quote `aa2c128a-1fae-42ec-9d71-b5d7a5d09423`
- `90A4AF5684E04C2D969A49BBF64F72FF` (history 1): quote `0aaf7744-45df-47b5-8613-7a8c71cd2725`, re-quote `8698cc84-dbf7-4bcb-9f1e-a22fb6bd3c3e`
- `93E576DA1D94486DA497D61288009E09` (history 1): quote `e6e65849-36f3-48f4-8a6c-0d5d0ee7a8ad`, re-quote `77d6ed01-492c-4ae7-85f7-f521408119b6`
- `957E0D322AD94F138625B5337A0021B4` (history 1): quote `0d59e683-8af9-4d56-963c-ab33f2a6bbce`, re-quote `6aa5ec1c-dbd5-4e40-95c2-9fc417e94842`
- `97446DCF8D58446CBD18D9376BCB6250` (history 1): quote `3cd9ed71-bad8-422d-8926-fed8638d256b`, re-quote `5b97402d-460d-42e4-ba51-a29ab2b94834`
- `9AAC38E8D2CC41039AA1C5DA499CF275` (history 1): quote `0cf6a319-83d7-409f-85c1-da1c670e5c59`, re-quote `4a36c8f6-e9ec-40cc-ae59-bf65327cf357`
- `9F8910C2DB0B431E9E85A21D6E7C9EA9` (history 1): quote `f8f561a8-d046-4f63-9d09-adbf56ae7b3e`, re-quote `2c01fae5-6f23-466d-9c35-5a8a587eaa4e`
- `9FA7D4FD5D044DC4BFDE4CE3739D0A82` (history 1): quote `89391229-387b-4872-83e2-7aa2dbb32bd4`, re-quote `d79dfb18-d484-42de-a52e-87a91b38292d`
- `A88A521C3B69486EB5C15891B0E845B2` (history 1): quote `e29bbcdc-6b8c-4c62-a396-54cd38c5b762`, re-quote `0e25b48a-b7e4-4229-9891-b1946422006c`
- `A9151678E4D94DB0A3894193A77D3776` (history 1): quote `36ceee16-5ce9-482f-9673-ccf051d2f75d`, re-quote `6f9c93cd-322a-4ea6-bc84-54c1da32e8f1`
- `ACBD3962655F4C5FA083AA12B8E68999` (history 1): quote `04533a04-2d8b-488d-836e-3442793e6c56`, re-quote `92b26bc1-8e1a-4fac-8d3d-19a7a693d4d4`
- `AF160CE8932E4D4DAFB0C3372E850306` (history 1): quote `1ffed127-e386-4857-a2c8-4815a05d8490`, re-quote `7dd88619-7a3d-4abc-8144-068b2b9c7957`
- `B6BF8E5CAD4D47DD984F129D0852EE6D` (history 1): quote `9f7daae8-1ed4-4c09-ab7b-b8547c6a5791`, re-quote `0d760bce-f890-4e0e-93b7-4fb5bbbc93a7`
- `BBC6794A2E7B4BDB907EA6FDABF63005` (history 1): quote `80ada18b-7c44-451a-a103-79e2e0f5ad30`, re-quote `56a9b97a-3a1c-4678-bcee-3e8da8769cc2`
- `BBE8890B81224E6BA39CFF9008313DA0` (history 1): quote `675d3ea1-87c3-42bd-ad26-e84eac17ffba`, re-quote `73896746-ca7a-4850-8ff7-6cbe6a0c6a0e`
- `C0D0F6247BF6429CB92CB092A39DC16C` (history 1): quote `d8e124e8-dd33-4976-a243-330d36187a8b`, re-quote `96d750a0-be5a-4958-8bc6-033f1a9d90f9`
- `C255815F2C934319AD79552E9650B1AF` (history 1): quote `ac4784b3-40af-4306-bffa-30ae2e413691`, re-quote `ad5799f7-2e4e-4e57-aca6-681fe9ff1674`
- `C2B1E113E76C40A4AE8E0E09F490383C` (history 1): quote `33aef991-0b88-45b4-8297-d77bedf85362`, re-quote `97475660-f276-4a14-af8e-fcc4abf77725`
- `C2B696EF9A3B4D2E8C504337D8B4911D` (history 1): quote `f97427d3-6c40-4a9e-b32c-160e6bc2c777`, re-quote `00122554-f238-40d8-9489-fbc3983eebae`
- `C4BD7D80306945BEB99B9D22882FE861` (history 1): quote `881a25c5-4caf-481b-af93-83b51af87fd4`, re-quote `74c625b6-3d34-4fb7-a774-19214f3f9720`
- `C6BF93AEE6F2430EBA1E8A587E58FF97` (history 1): quote `5970fe89-de0e-4e0c-8b77-704a99ab6029`, re-quote `ff41cea7-42e5-459c-b621-fcef1843dd72`
- `CF27030ED1CD4C91831AC521F8574CC3` (history 1): quote `65007151-8818-46d5-8d33-c6fffaf077ca`, re-quote `be81cb52-d471-454f-88ae-c81c43dbaeaa`
- `D21AAB7DBBF649A5A9F95DA7FB3A0CA0` (history 1): quote `e1614b62-abf7-456f-af5c-3d966f368974`, re-quote `6c0ceac2-6e6a-4729-ab9f-f7148c6e2a8a`
- `DDCA2EE282B74E558D20F211F9B9FED6` (history 1): quote `97d8fbb7-557f-413d-93c2-064b9ab3a58d`, re-quote `d6ff2215-55be-468e-bbfd-737ab5651f34`
- `E1E12F59CCAC4FFBADDD269E8BE53E29` (history 1): quote `3b8bc899-ed96-4779-bef4-d3724c8d0377`, re-quote `aadd7a51-a9b6-4f7b-abbf-cd5177817220`
- `E69EE6D0C0E54EFCB16FA5EB83A5A3AC` (history 1): quote `87864289-48c5-4079-b3d1-bff00d24bc81`, re-quote `1201ebe6-7fd7-40c0-ae2c-65f9b765a6f5`
- `EE6A88752A1849DF9ED432BFEA8C2FD1` (history 1): quote `afc914ea-d402-49ed-a688-adf7275b116e`, re-quote `71d9a6e8-5e9f-43b8-9c61-ecd42b511b28`
- `EE9A15E884DD4BDB89A1DA6FB798148A` (history 1): quote `fe2f79a1-9706-4490-bdc0-825beb4c757c`, re-quote `0e4d7aba-f9fb-4694-ac86-94e909288ede`
- `EF4073A035EC4FCD8DDCD1E7C5EEBBA7` (history 1): quote `b056233e-564a-4d2d-8186-95a3bce00ea8`, re-quote `d6314ba7-0820-4c0c-9b51-07af372a3120`
- `F191B1B8EEB4482984EE11BAFF727ACC` (history 1): quote `e93fd94d-65b0-4005-8909-b640b17a353f`, re-quote `7a0d08b1-3ce8-488c-ae1b-562cfde30409`
- `F430FEDAB15441ACB8FE4110435CBBAC` (history 1): quote `c359bf1d-a1ce-445d-9a43-5b2d457bec1b`, re-quote `ff157dd8-0340-4c3f-b018-a6bfad671c95`
- `FA58166C702043FC86F8691D7E11F5E7` (history 1): quote `1da50dea-1853-4fe4-b17a-64070b543cf4`, re-quote `52ce1b3f-19ed-40da-bea3-7d19fd2177fc`

### Open issue 2: Rent (from Local Authority) (`RLA01`) (12)

- `040E53264C8B4DB4AE87E69CE58C4A2E` (history 1): quote `08833eba-7569-4120-a5ae-66cacddba54b`, re-quote `6cc795cc-f760-4b17-9b86-d2e930390120`
- `0FEDA232090542B5A68F2F85D1B89256` (history 1): quote `eedee54d-3b6e-4c7e-994b-16f9d886cc26`, re-quote `3961b5f9-9145-4402-b8f8-d9489ea45d94`
- `10C2F4D31349407A8EA730A2E1308E52` (history 1): quote `d061a67e-16d8-45ec-890b-1275721cb52a`, re-quote `723dbce4-0857-422f-aedb-abf429ba3b95`
- `32C277ACDD1148E0AA5D2868F5EC7183` (history 1): quote `197a1181-a4cf-4b1f-be7c-1b86f6e566a0`, re-quote `98214030-2053-48a3-b66e-89ef15ee075e`
- `3E08F61A52B044F4BC8DBDE704A1A1E3` (history 1): quote `fa6159a5-e6f9-453d-8feb-6a303dcd25e6`, re-quote `d3e5530e-230e-432e-b328-6bfe9e0056ed`
- `6404F642EAC54F0D92D8378B458DB703` (history 1): quote `e30175df-38ff-43e2-995c-26be01bdd89d`, re-quote `2fdba543-7a0e-4669-86c2-95ece12d4482`
- `718CA449FCFC4A959D99124EDC81EA87` (history 1): quote `eb175ec3-7ed2-47dd-9c70-4431498d1e2e`, re-quote `f8d750e3-c45a-4b3c-90b1-2ad29082d59b`
- `728F6E156E494D42AF0EBB386D903E61` (history 1): quote `467df704-3145-417a-b325-cc034f1486db`, re-quote `1f69f0e8-88a0-424f-abda-26463d4eb2fc`
- `93DE5965C3A14A3FA81FA9590F9B4E76` (history 1): quote `3f017d7a-0c6c-40b8-99b5-ba9b806d4deb`, re-quote `119d28cd-48ad-4335-b460-ba591b25f694`
- `98708668B62F4A489434DAD26D54B029` (history 1): quote `f5c9aaa4-664b-4bb0-9be3-a3a79694c89a`, re-quote `5facc14d-397a-44ae-9b98-d864b292fc94`
- `F3AC5B06FA9D47C8B867F0E9D118883D` (history 1): quote `87564d42-b0e7-4449-9baa-c49382c835e8`, re-quote `d946bb25-29fd-445b-8cc1-de5f663f66a1`
- `FF6F129053DB462698A1F095BCF202B8` (history 1): quote `40b774ab-b670-44fe-984d-255f215a5915`, re-quote `9023f7be-40bc-4fd0-a035-39dd71a1d1c2`

### Open issue 6 (6)

- `1A13B1F1243841B4BB2A9DD9340868B3` (history 1): quote `b97cc0fb-828c-47f8-a77e-fbbf9f5066f9`, re-quote `3d454872-de2e-455c-91e4-8fdc42c792b3`
- `3763F4DCDDE74265A3F3A024E8CEE3C9` (history 1): quote `fb6d3296-7660-4327-87a3-5483950308a3`, re-quote `28d4d116-c8b2-48fa-ba4f-8965e97226ed`
- `5E9CA3D0E80B4278B4D896612B2CEF52` (history 1): quote `adeb28e4-9100-4b0d-a44f-4a46b1b40554`, re-quote `12d35dde-222b-4678-8477-7a85e0d87dd3`
- `6284D0B9487B4C63ACE4EC0D5979E4BD` (history 1): quote `38977162-863d-44d2-a47c-7656adb617cb`, re-quote `b1c10b47-8ebe-4de7-9107-aaa2707f8d53`
- `73CDBA85021E4DD6AF2EB8BDBEFB57E2` (history 1): quote `64b55210-e609-421a-aa52-117ab3056ea0`, re-quote `ded7b378-5901-46a5-939b-d393dba54d67`
- `790E50D7F20E4672855A529A75A36AAD` (history 1): quote `7d580c14-7069-4a60-abf1-b11febbca71a`, re-quote `cc5ce310-e86f-4ee9-b28c-f47333a30ff3`
