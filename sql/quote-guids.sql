-- Candidates for a quote-pages GUID list: unpurchased NHI home quotes linked to a TCAS policy, one TCAS policy details
-- ID (32 hex characters, no dashes) per row. new-guid-list keeps those the Policy API finds, in this order. Run by new-guid-list (Run-Project.ps1 -NewGuidList)
-- with sqlcmd against an environment's NHI_Applications database; $(MaxCount) is a sqlcmd variable.
--
-- Each policy's first agreement is used: later agreements with the same Transactor_Policy_Details_ID are clones (for
-- example the replacement quotes quote-pages requests), so they would list the same policy again. Policies with any
-- purchased agreement are left out, as are quotes from the last hour, which may still be in progress.
--
-- Direct (affiliate 1, or none) and agent quotes come first, newest first, then aggregator quotes. On stg and tst nearly
-- all quotes are bulk aggregator quotes with no TCAS policy (Policy API 404), while direct and agent quotes have one; on
-- dev aggregator quotes have one too.
SET NOCOUNT ON;

SELECT TOP ($(MaxCount)) a.Transactor_Policy_Details_ID
FROM Agreement a
WHERE a.Transactor_Policy_Details_ID IS NOT NULL
  AND a.Product_Type_ID = 1
  AND a.Created_Datetime < DATEADD(hour, -1, GETDATE())
  AND NOT EXISTS (
    SELECT 1
    FROM Agreement other
    WHERE other.Transactor_Policy_Details_ID = a.Transactor_Policy_Details_ID
      AND (other.Policy_Reference_No IS NOT NULL OR other.Created_Datetime < a.Created_Datetime)
  )
ORDER BY
  CASE WHEN a.Affiliate_ID = 1 OR a.Affiliate_ID IS NULL OR a.Call_Media_User_Code IS NOT NULL THEN 0 ELSE 1 END,
  a.Created_Datetime DESC;
