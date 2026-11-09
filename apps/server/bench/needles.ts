// The 25 planted facts of the recall benchmark, shared with the script that freezes their map (extract-needle-map.ts).
// Planted facts: [scope kind, text, lexical query, paraphrase query (no shared content words)]
export type Needle = { scope: "user" | "project" | "agent"; text: string; lex: string; para: string }
export const NEEDLES: Needle[] = [
  { scope: "user", text: "Daughter's name is Marina and she starts school in March.", lex: "when does Marina start school?", para: "when do classes begin for my kid?" },
  { scope: "user", text: "Prefers dark roast coffee without sugar.", lex: "how do I like my coffee roast?", para: "what hot drink should you bring me in the morning?" },
  { scope: "user", text: "Runs a half marathon every October in Lisbon.", lex: "which marathon do I run in Lisbon?", para: "what race am I training for this autumn?" },
  { scope: "user", text: "Is allergic to penicillin.", lex: "am I allergic to penicillin?", para: "which antibiotic can't I take?" },
  { scope: "user", text: "Reads code reviews on an iPad during the commute.", lex: "where do I read code reviews on the iPad?", para: "what device do I use on the train?" },
  { scope: "user", text: "Speaks Portuguese at home and English at work.", lex: "do I speak Portuguese at home?", para: "which tongue does my family use?" },
  { scope: "user", text: "Hates being interrupted with notifications before 10am.", lex: "can you send notifications before 10am?", para: "is it okay to ping me early?" },
  { scope: "user", text: "Drives a 2019 Volvo XC40 hybrid.", lex: "which Volvo do I drive?", para: "what car do I own?" },
  { scope: "project", text: "The billing service deploys to Fly.io from the release branch.", lex: "where does billing deploy?", para: "how do payments go live?" },
  { scope: "project", text: "Postgres backups run nightly at 03:00 UTC to an S3 bucket named zorel-pg-archive.", lex: "when do the postgres backups run?", para: "what time is the database snapshot taken?" },
  { scope: "project", text: "The staging environment password rotates every 30 days.", lex: "how often does the staging password rotate?", para: "when do pre-production credentials change?" },
  { scope: "project", text: "Image uploads are capped at 12 megabytes by the CDN.", lex: "what is the image upload cap?", para: "how big can a picture be?" },
  { scope: "project", text: "The mobile app supports Android 10 and newer only.", lex: "which Android versions does the app support?", para: "what's the minimum phone OS?" },
  { scope: "project", text: "Customer emails are sent through Postmark, never SES.", lex: "do customer emails go through Postmark?", para: "which provider delivers our transactional mail?" },
  { scope: "project", text: "Kubernetes namespace for the search cluster is search-prod-eu.", lex: "what namespace is the search cluster in?", para: "where does the lookup engine run in k8s?" },
  { scope: "project", text: "Invoices must be kept for seven years for tax compliance.", lex: "how long must invoices be kept?", para: "what is our retention period for bills?" },
  { scope: "project", text: "The design system uses Inter for body text and Söhne for headings.", lex: "which font for headings in the design system?", para: "what typeface do titles use?" },
  { scope: "project", text: "Load tests showed the checkout endpoint saturates at 1,800 requests per second.", lex: "when does the checkout endpoint saturate?", para: "what's the throughput ceiling of the purchase API?" },
  { scope: "project", text: "The analytics warehouse is BigQuery, dataset events_v2.", lex: "which BigQuery dataset is the analytics warehouse?", para: "where is telemetry stored for reporting?" },
  { scope: "project", text: "Legal approved the new privacy policy on 2026-09-14.", lex: "when did legal approve the privacy policy?", para: "did the lawyers sign off on the data notice?" },
  { scope: "agent", text: "When writing SQL migrations, always add a down migration and test it on a copy of production.", lex: "how should I write SQL migrations?", para: "what's the rule for schema changes?" },
  { scope: "agent", text: "Before touching the auth module, read docs/auth-threat-model.md.", lex: "what to read before the auth module?", para: "anything to review before changing login code?" },
  { scope: "agent", text: "The flaky test in payments_spec retries three times on CI; ignore single failures.", lex: "is the payments spec test flaky?", para: "a checkout check broke once in the pipeline, should I worry?" },
  { scope: "agent", text: "Translations live in locales/*.json and must keep keys sorted alphabetically.", lex: "where do translations live?", para: "how do I add a new language string?" },
  { scope: "agent", text: "Use pnpm, not npm, in the legacy dashboard repository.", lex: "pnpm or npm in the legacy dashboard?", para: "which package manager for the old admin panel?" }
]
