# ContractSoup

Checks healthcare insurance contracts for hidden fees, unusual charges and pricing problems.

Upload a contract PDF and, if you have one, a claims file. ContractSoup reads both in your browser and lists
anything worth a closer look, with the page and clause as evidence. The report is for review by your legal
team. It is not legal advice.

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

## Privacy

- Contract and claims files are read in the browser and are never uploaded.
- With sign-in on, only the report is saved to the account: the contract terms with their short excerpts,
  the findings and the totals. Claim rows and member identifiers are not stored anywhere.
- The check thresholds are kept on the device.

## Not included

- Export of findings to CSV.
- A choice of currency. Amounts are in US dollars.
- Analysis on a server. `src/analyzer/remote.ts` is a placeholder that nothing uses.
