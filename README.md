# ContractSoup

Checks healthcare insurance contracts for hidden fees, unusual charges and pricing problems.

Upload a contract PDF and, if you have one, a claims file. ContractSoup reads both in your browser and lists
anything worth a closer look, with the page and clause as evidence. The report is for review by your legal
team. It is not legal advice.

The contract can be read in two ways. The built-in reader works on the device and sends nothing anywhere. The
optional [Gemini reader](#the-gemini-reader-optional) understands what clauses mean, and sends the text of the
contract's pages to Google Gemini to do it. It is off until you set it up, and is then chosen for each audit.

## Run it

Needs Node.js 20.19 or newer, or 22.12 or newer (built and tested on Node 22).

```
npm install
npm run dev
```

Open the address the terminal shows. **Try a sample audit** on the dashboard runs a built-in example, so you
can see a full report without files of your own.

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the app for development |
| `npm run build` | Builds the site into `dist/` |
| `npm run preview` | Serves the built site |
| `npm run eval` | Runs the checks against the built-in sample and reports what they found |
| `npm run typecheck` | Checks the types. `npm run build` does not |
| `npm test` | Runs the tests. See [Tests](#tests) |

## Where reports are saved

- **Without sign-in (the default):** on this device, in the browser's own storage. Nothing is uploaded.
- **With sign-in:** in the signed-in person's account, in the Supabase table `audits`.

A build uses one or the other, never both. The sidebar and the Settings page say which.

## Turn on sign-in

1. Copy `.env.example` to `.env`. On a hosting service, set the same two values there instead:
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. They are read when the site is built, so
   restart `npm run dev` or build again after changing them.
2. In the Supabase dashboard, open the SQL editor and run [`supabase/audits.sql`](supabase/audits.sql). It
   creates the table if it is missing, turns on row-level security and adds the rules that let each person
   read and change only their own reports. It is safe to run more than once and drops nothing.
3. Sign in, open **Settings** and press **Check account storage**. It confirms that reports save and that
   nobody else can read them. All eight steps should pass. If one fails, the page says why and what to do.

Use the publishable key only. Never put the `service_role` (secret) key in this project.

## The Gemini reader (optional)

The built-in reader finds 14 kinds of financial term by their wording. The Gemini reader reads for meaning:

- the same 14 financial terms, and 12 further kinds of provision: payment terms, performance guarantees,
  obligations, the contract term, termination rights, restrictions, exceptions, compliance, data and
  confidentiality, liability and indemnity, dispute resolution, and other provisions;
- for each, the conditions and exceptions it states, its dates and its notice period;
- observations about risk in the wording, such as an open-ended cost or a one-sided right.

What stays the same:

- **A person confirms every term.** Everything Gemini finds arrives unconfirmed, next to the contract wording
  it rests on. That wording is checked against the PDF, on the server and again in the browser. An item whose
  quotation is not in the contract is left out.
- **The money is worked out on the device**, by the same checks as before, from confirmed terms and your
  claims. Gemini's observations carry no dollar amount and add nothing to the estimated exposure. In the
  report and the PDF they are marked "AI reading".
- **Nothing happens silently.** The reader is chosen for each audit and needs a tick of agreement each time.
  If Gemini fails, the audit stops and says why. The built-in reader takes over only when you ask it to.

It is offered only in builds that have sign-in, because the request is made as the signed-in person.

### Set it up

You need sign-in turned on (above), the [Supabase CLI](https://supabase.com/docs/guides/local-development)
and a Gemini API key.

1. **Get a Gemini API key** at <https://aistudio.google.com/apikey>. For real contracts, use a key from a
   Google project with billing turned on. See [Privacy](#privacy) for why.
2. **Link this folder to your Supabase project:**

   ```
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   ```

3. **Give the function the key.** It is a secret of the Supabase project and goes nowhere else:

   ```
   supabase secrets set GEMINI_API_KEY=YOUR_KEY
   ```

   The Dashboard does the same under **Edge Functions > Secrets**.
4. **Deploy the function:**

   ```
   supabase functions deploy extract-contract-terms
   ```

5. **Check it.** Sign in to the app, open **Settings** and press **Check AI reader**. "Ready" means the
   function is deployed, has a key and reached the model. If not, the message says which of those failed.
   The check sends no contract text.
6. **Decide who may use it.** Every request costs you Gemini usage. Unless you limit it, anyone who can sign
   in to the project can use the reader. Set `AI_ALLOWED_USER_IDS` to the accounts that may, and turn off new
   sign-ups in the Supabase dashboard if you do not want them.

**Where the key may and may not go.** The key is read in one place,
[`supabase/functions/extract-contract-terms/index.ts`](supabase/functions/extract-contract-terms/index.ts),
from the function's environment. Never put it in the root `.env`, in a variable whose name starts with
`VITE_`, or anywhere under `src/`: everything there ends up in the browser. `npm test` fails if it finds a key,
or a way to call Google directly, in the app's source or in the built site.

### Run it on your own machine

This needs Docker.

```
cp supabase/functions/.env.example supabase/functions/.env   # then put your key in the copy
supabase start
supabase functions serve extract-contract-terms
```

`supabase start` reads `supabase/functions/.env`, which git ignores. Point the app at the local project by
putting the URL and publishable key that `supabase status` prints into the root `.env`, then restart
`npm run dev`. The local project starts empty: run [`supabase/audits.sql`](supabase/audits.sql) in its SQL
editor and sign up an account in the app.

### Settings

All of these are secrets of the Supabase project, set like the key. Only `GEMINI_API_KEY` is required.
[`supabase/functions/.env.example`](supabase/functions/.env.example) lists them with their defaults.

| Setting | Default | What it does |
| --- | --- | --- |
| `GEMINI_API_KEY` | none | The key. Without it the function answers "not configured" and sends nothing to Google |
| `GEMINI_MODEL` | `gemini-3.8-flash` | The model that reads contracts. Change it here, not in the code |
| `GEMINI_THINKING_LEVEL` | the model's own | `low`, `medium` or `high`. Lower is faster and cheaper |
| `GEMINI_TIMEOUT_MS` | `120000` | Longest one call to Gemini may take |
| `GEMINI_MAX_RETRIES` | `2` | How often a call that failed for a passing reason is tried again |
| `AI_REQUEST_DEADLINE_MS` | `140000` | Longest a whole request may take. Supabase gives up on a function after 150 seconds |
| `AI_MAX_PAGES_PER_REQUEST` | `60` | Size limits for one request. The app sends less: see below |
| `AI_MAX_CHARS_PER_PAGE` | `30000` | |
| `AI_MAX_TOTAL_CHARS` | `200000` | |
| `AI_ALLOWED_USER_IDS` | everyone signed in | Only these accounts may use the reader. User ids, separated by commas |
| `AI_ALLOWED_ORIGINS` | any website | Only pages served from these addresses may use the reader, for example `https://your-app.example.com` |
| `AI_LOG_UPSTREAM_ERRORS` | `false` | Also logs the text of Google's error messages. For finding a setup problem only: that text can repeat parts of a request |

Less often needed: `GEMINI_API_BASE_URL`, `GEMINI_API_VERSION`, `GEMINI_API_REVISION` and `AI_MAX_BODY_BYTES`.

### How a contract is read

1. The browser reads the PDF, as it always has. The file is not uploaded.
2. The text of the pages goes to the function in requests of at most 25 pages or 80,000 characters. Blank
   pages are not sent.
3. The function checks that the caller is signed in by asking the project's Auth server, then sends the pages
   to Gemini through the [Interactions API](https://ai.google.dev/gemini-api/docs/interactions) and asks for
   an answer in a fixed shape.
4. Each item in the answer must quote the contract. The function looks for every quotation on the page it
   names. A quotation found on another page has its page put right. One found nowhere is left out. A figure
   that is not in its quotation is kept, but marked **Needs review**. What is stored is the page's own
   wording, not Gemini's copy of it.
5. The browser makes the same checks again against its own copy of the pages.

One answer holds at most 80 terms and 25 observations, and has to arrive within the time limit. When a
request reaches the limit on terms, is cut short, or gets no answer in time, its pages are asked about again
in two halves, so a dense contract is read in full. If a single page reaches the limit, its terms are kept
and the review step names the page as one that may hold more.

Limits: a PDF of up to 600 pages and 100 MB, with text in it (scanned copies have none), and up to 30,000
characters on a page. How long a reading takes depends on Gemini. Each request is given up to 140 seconds,
and the first step shows how many pages have been read so far.

### What a failure looks like

The audit stops with a notice that names the cause: the function is not deployed, the key is missing or was
refused, the model is not available to the key, Gemini is too busy or did not answer, or the account or the
website is not allowed. Where asking again can help, **Try Gemini again** asks only for the pages that are
still missing. **Use the built-in reader instead** reads the same pages on the device.

## Privacy

- Contract and claims files are read in the browser and are never uploaded.
- With sign-in on, only the report is saved to the account: the contract terms with their short excerpts,
  the findings and the totals. Claim rows and member identifiers are not stored anywhere.
- The check thresholds are kept on the device.

With the Gemini reader, and only for an audit where it was chosen and agreed to:

- **Sent:** the text of the contract's pages with their page numbers, to your Supabase function and from
  there to Google. The function adds its instructions and your key.
- **Not sent:** the PDF file, its name, the claims file or anything from it, saved reports, and who is asking.
  Google sees your key's project, not the person.
- **Not kept by this project:** the function stores nothing. Its log holds the account id of whoever asked,
  counts and timings, and never contract text. The app drops the page text once the terms are ready.
- **What Google does with it** is set by Google's [terms for the Gemini API](https://ai.google.dev/gemini-api/terms).
  Each request asks Google not to store it (`store: false`). Beyond that, the terms treat free and paid use
  differently. At the time of writing, text sent with a key on the free plan may be used to improve Google's
  products and read by reviewers, and Google says not to send confidential information that way. With a key
  from a project that has billing turned on, it is not used to improve Google's products, though Google keeps
  requests for a limited time to detect abuse. Read the terms before sending a real contract, and check them
  again from time to time.

## Tests

```
npm run build
npm test
```

Build first: one test scans the built site for keys. The tests cover the function (its checks on the caller,
on the request and on Gemini's answer), the app's side of the reader, saved records and the PDF, and the
absence of secrets from the app.

**No test calls Google or your Supabase project.** Gemini, the Auth server and the `audits` table are
stand-ins that run on the machine. The function has not been run on Supabase's own servers by these tests.
Press **Check AI reader** in Settings after you deploy.

Two groups of tests are skipped, and say so, unless their tools are present:

| Tests | What they do | What they need |
| --- | --- | --- |
| `deno-function` | Run the function's real entry file under Deno, over HTTP | Deno: `npm i --no-save deno`, or set `DENO_BIN` |
| `browser-flow` | Use the built app in Chrome the way a person does: consent, a failure, a dense contract, a whole audit and its PDF | `npm i --no-save puppeteer-core`, and Chrome. Set `CHROME_BIN` if it is not in a usual place |

`BROWSER_SHOTS=shots npm test` also saves a picture of each main screen of the Gemini reader in `shots/`.
In a container, Chrome usually needs `CHROME_ARGS="--no-sandbox"`.

## Not included

- Export of findings to CSV.
- A choice of currency. Amounts are in US dollars.
- Reading scanned contracts. Neither reader can read a PDF that has no text in it.
- Dollar estimates from Gemini. It reads wording. The amounts come from the checks on the device.
- A limit on how much one account may use the Gemini reader. Use `AI_ALLOWED_USER_IDS`, and the spending
  limits of your Google project.
