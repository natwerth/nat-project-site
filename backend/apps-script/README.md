# Services form: Apps Script deployment and operations

The implementation connects the existing Services form directly to a versioned Apps Script web app. The web app records requests in a private Google Sheet and sends owner/visitor emails through the `info@natwerth.com` Gmail alias, executing as `nat@natwerth.com`.

The user chose **Apps Script only**: no Worker, Turnstile, or other external spam service. Honeypot validation, submission/send caps, quota reservation, and a pause switch limit abuse; they do not establish that a visitor is human. The public URL is not a secret, and anonymous invocations can consume execution quota even when the script rejects them.

## Verification status

Local tests establish application behavior with service doubles. They cannot establish Google's deployment permissions, CORS behavior, account alias, live Sheet writes, or inbox receipt. Record actual deployment evidence below before describing the form as live.

| Gate | Required evidence | Initial status |
| --- | --- | --- |
| Harmless browser transport | Readable success and rejection from the live `https://www.natwerth.com` origin, anonymous Chrome and Safari | Not yet verified |
| Private Sheet tracking | Actual row and attempt records; duplicate/concurrency and literal-text checks | Not yet verified |
| Live email sending | Authorized test to `nat@natwerth.com`; both messages, alias, reply-to, and row states inspected | Not yet verified |
| Production cutover | Production `/exec` configured, frontend published, current public page tested | Not yet verified |

The approved test recipient is **nat@natwerth.com**. Use synthetic details for live tests. Other people's addresses require a concrete test-recipient instruction.

## Local layout and checks

- `src/`: production Apps Script source and manifest.
- `probe/src/`: separate harmless Apps Script source; no email, Sheets, external fetch, storage, or triggers.
- `probe/index.html`: optional browser test page; creating this local file does not publish it.
- `tests/transport-snippet.js`: browser-only transport check that can run from DevTools on the existing live Services page.
- `tests/`: local application tests. No test in this folder proves cloud deployment.

From the repository root:

```sh
node --test backend/apps-script/tests/*.test.cjs
```

Keep `.clasp.json`, OAuth credential files, and deployment notes with private identifiers out of Git. Never paste a `.clasprc.json` file, OAuth code, refresh token, or Google password into chat. The frontend needs only the public versioned endpoint URL; it must never contain a shared backend password.

## 1. Authorize the deployment account

The local toolchain checked for this implementation is Node `v24.6.0` and clasp `3.3.0`. These instructions use clasp 3 command names; check `clasp --version` and command `--help` after upgrading. [Clasp's own command reference](https://github.com/google/clasp#commands) describes the current names and aliases.

1. Sign in to Google as `nat@natwerth.com` and enable the Apps Script API at [Apps Script user settings](https://script.google.com/home/usersettings).
2. Run `clasp login` in a local terminal and finish Google's OAuth flow in the browser. This authorizes clasp to manage projects; it does not itself authorize the form's Gmail operations.
3. Run `clasp show-authorized-user` to confirm the intended account. Do not display credential-file contents.

## 2. Deploy the isolated harmless probe

Use a **new, separate** Apps Script project for the probe. Do not push probe code over a form project. The manifest specifies `USER_DEPLOYING` and `ANYONE_ANONYMOUS`; `ANYONE` alone requires a Google login. Workspace policy may prevent anonymous deployment. [Google's manifest reference](https://developers.google.com/apps-script/manifest/web-app-api-executable) defines these settings.

The easiest first deployment is through the Apps Script editor:

1. Create a standalone project named `natwerth.com — harmless transport probe` under `nat@natwerth.com`.
2. Replace its starter code with `probe/src/Probe.gs`. Enable **Show appsscript.json manifest file in editor** in Project Settings, and copy `probe/src/appsscript.json` to the manifest.
3. Deploy → New deployment → Web app. Select execution as the deploying owner and access for anyone, including signed-out visitors. Confirm the deployed settings; the account policy takes precedence over a local manifest.
4. Copy the new deployment's `/exec` URL. Do not use `/dev` or a redirected `script.googleusercontent.com` URL. `/dev` is restricted to script editors. [Google's web app guide](https://developers.google.com/apps-script/guides/web) explains these deployment identities and URLs.

For clasp, create the new project in an empty scratch directory so its generated starter manifest cannot overwrite reviewed source:

```sh
clasp create-script --title 'natwerth.com — harmless transport probe' --type standalone
```

Copy **only the returned script ID** into a local, ignored `probe/.clasp.json`:

```json
{ "scriptId": "THE_NEW_PROBE_SCRIPT_ID", "rootDir": "src" }
```

Then run from `backend/apps-script/probe`:

```sh
clasp show-file-status
clasp push
clasp create-version 'Harmless transport probe v1'
clasp create-deployment --versionNumber VERSION_NUMBER --description 'Harmless transport probe v1'
clasp list-deployments
```

Replace `VERSION_NUMBER` with the returned integer. `show-file-status` must list only `Probe.gs` and `appsscript.json`. In the editor, verify the resulting web-app access/owner settings and authorize if requested. This probe's manifest requests **no OAuth service scopes**.

## 3. Prove browser transport without publishing a form change

Google ContentService redirects output to a temporary `script.googleusercontent.com` URL. Follow redirects and continue using the stable `/exec` URL for requests. The documentation does not guarantee that every account/deployment response can be read by this site's browser fetch. [ContentService redirects](https://developers.google.com/apps-script/guides/content#redirects).

The request uses `URLSearchParams({ payload: JSON.stringify(payload) })`, `credentials: 'omit'`, CORS mode, and normal redirect following. Let the browser choose its form-encoded content type. Avoid custom headers. This avoids the usual JSON-content-type preflight, but readable responses still require the relevant CORS behavior. [Browser CORS rules](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS).

No production publish is needed for the first proof:

1. Open the existing **https://www.natwerth.com/services/** page in Chrome.
2. Open DevTools, paste the contents of `tests/transport-snippet.js`, then call:

   ```js
   await window.natwerthTransportProbe.run('https://script.google.com/macros/s/PROBE_DEPLOYMENT_ID/exec')
   ```

3. Save the returned report and inspect the browser Network/Console if any check fails. It reports page origin, browser, UTC measurement time, response readability, redirect destination origin, and elapsed time without exposing temporary redirect URLs or unexpected response bodies.
4. Repeat in Chrome Incognito and native Safari, including Safari Private Browsing. Browser automation with a fresh context is useful corroboration; Playwright WebKit is not native Safari evidence.
5. Repeat after publishing the actual form, because the application's integration and page policies also matter.

The snippet first recognizes the isolated probe by a harmless GET response and then checks successful POST, safe rejected POST, and malformed JSON. Its 60-second timeout is a **test deadline**, not evidence that the production form needs that timeout. Measure several actual successful calls before choosing the form timeout.

The optional `probe/index.html` presents the same checks with a URL field and results display. It and `tests/transport-snippet.js` must be served at their relative paths on the actual www origin to prove that origin; `file://`, localhost, or an intercepted HTML document is not proof that the actual published page works. Publish the test page only as an intentional site change; do not change the live form endpoint just to test it.

Pass requires readable, contract-valid JSON for all cases with `credentials: 'omit'` and no Google login prompt. An HTTP 200 alone, `curl -L`, a `no-cors` request, or an iframe load event does not pass this gate. TextOutput has no arbitrary response-header or HTTP-status setter. [TextOutput API](https://developers.google.com/apps-script/reference/content/text-output).

If blocked, capture browser/version/mode, request origin, response/redirect status, whether Google requested login, elapsed time, and the Console error. Keep the form paused. A Google-hosted HTML Service component with `google.script.run` is a possible separate design to assess; do not silently restore a Worker or replace the form with an iframe.

## 4. Create and configure the form project

Create a separate standalone project under the same account, named `natwerth.com — services form`. Use the same empty-directory clasp creation pattern or create it in the editor. Set local `backend/apps-script/.clasp.json` to that project's ID and `rootDir` to `src`, then:

```sh
clasp show-file-status
clasp push
clasp open-script
```

The file list must contain only the main `src` Apps Script files and its manifest, **not** the probe, browser tests, README, or website source. A clasp push replaces the remote project's source; confirm the target ID before doing it.

Run these functions in the Apps Script editor as the owner:

1. `initializeConfiguration()` — fills missing safe defaults. Inspect Script Properties before proceeding.
2. `setupSpreadsheet()` — creates or validates the environment's private Sheet. Do not publish it or change link access.
3. `setupDiagnostics()` — checks configuration, schema, alias availability, and quota without sending email.
4. `installRetryTrigger()` — installs the single `retryPendingEmails` timer. Re-running should not create another timer.

During Google's authorization prompt, review the manifest scopes. **GmailApp requests broad Gmail access, not a send-only permission.** This implementation needs alias lookup and email sends; it does not implement inbox-reading automation. Sheet access and trigger management require their own scopes. [GmailApp authorization and send options](https://developers.google.com/apps-script/reference/gmail/gmail-app).

Setup must confirm that `GmailApp.getAliases()` contains `info@natwerth.com`. An alias configured elsewhere is insufficient if the executing account does not expose it. Never substitute an unverified from-address.

### Script Properties

All values are strings. The defaults below are conservative starting caps and can be adjusted intentionally.

| Property | Initial value / role |
| --- | --- |
| `ENVIRONMENT` | `test`; only `test` or `production` |
| `PAUSED` | `true`; set `false` only when ready for test/live submissions |
| `TEST_EMAIL_ENABLED` | `false`; explicit gate for real mail in test mode |
| `TEST_RECIPIENT` | `nat@natwerth.com`; test deliveries are constrained to this address |
| `TEST_ALLOWED_RECIPIENTS` | `nat@natwerth.com`; comma-separated approved test visitor addresses |
| `TEST_SPREADSHEET_ID` | Populated by setup for test data |
| `PRODUCTION_SPREADSHEET_ID` | Populated by setup for production data |
| `OWNER_ADDRESS` | `nat@natwerth.com` |
| `SENDER_ALIAS` | `info@natwerth.com` |
| `SITE_NAME` | `Nat Werth` |
| `RECIPIENT_HOURLY_CAP` | `3` new requests per normalized recipient per rolling hour |
| `SUBMISSION_DAILY_CAP` | `50` new requests per rolling 24 hours |
| `SEND_DAILY_CAP` | `100` email attempts per rolling 24 hours |
| `QUOTA_BUFFER` | `50` recipients preserved for other account activity |
| `MAX_ATTEMPTS` | `3` per email, only when conclusively safe to retry |
| `RETRY_BASE_SECONDS` | `300`, with increasing delay and capped attempts |
| `LEASE_SECONDS` | `600`, prevents overlapping foreground/trigger claims |
| `RETRY_BATCH_SIZE` | `10` pending requests checked per trigger batch |

Test and production use different spreadsheet IDs and environment metadata. Do not repurpose the same Sheet for both environments. For strongest isolation use separate test and production script projects with their own properties, Sheets, deployment IDs, and owner-installed triggers. Properties and Sheets are not versioned with source deployments: changing `ENVIRONMENT` affects every deployment of that same script project.

## 5. Validate real Sheet and email behavior in test mode

Keep `ENVIRONMENT=test`, and use only synthetic data and the approved `nat@natwerth.com` visitor address. After inspecting diagnostics, set `TEST_EMAIL_ENABLED=true` and `PAUSED=false` in Script Properties. Deploy a versioned `/exec` with the owner/anonymous settings already proved by the probe.

Create a version and deployment:

```sh
clasp create-version 'Services form test candidate'
clasp create-deployment --versionNumber VERSION_NUMBER --description 'Services form test candidate'
```

Exercise the candidate frontend against this endpoint locally or through a deliberate test page before production cutover. Run each service and both `details`/`booking` intents; spread live sends across the configured limits and use no third-party recipient. Record whether each case was exercised with local mocks, a cloud request, or actual email.

Verify in the real Sheet and mailbox:

- The request exists before either email is attempted, with only active-service fields and no raw receipt token.
- Exactly one row exists after duplicate requests using the same request ID, payload, and receipt credential. Changed payload under an old ID is rejected. An incorrect receipt reveals no state.
- Owner and visitor messages arrive at the authorized test address, with From `Nat Werth <info@natwerth.com>`. Owner Reply-To is the validated visitor; visitor Reply-To is `info@natwerth.com`.
- The visitor message has fixed wording and reference; a booking request does not confirm an appointment or promise a turnaround time.
- Both email state records and actual attempt records agree. `sent` means Google accepted `sendEmail`, not inbox delivery or absence of a bounce.
- Leading `=`, `+`, `-`, and `@` samples remain literal strings; the corresponding cells' formula values are empty. Use fake content only.
- Chrome/Safari desktop/mobile layouts preserve validation, service tiles, keyboard focus, and accessible status announcements.
- Success shows `Sent` before Thank You. A recorded request with mail pending says it was saved. A lost response preserves typed data and recovers status with the same ID/receipt. No PII or receipt is put in a URL.

The local suite should separately exercise malformed/oversized input, missing and whitespace-only required fields, invalid services/intents/email, header injection, honeypot rejection, pause/caps/quota exhaustion, simultaneous duplicates, foreground/trigger overlap, Sheet failures, and interrupted email sends. Do not deliberately create uncertain real email sends just to test a failure path; use service doubles for those injected faults.

## 6. Production cutover

1. Finish the separate browser, Sheet, and authorized email gates above.
2. Prepare the production project/properties and its new private Sheet with `ENVIRONMENT=production` and `PAUSED=true`. Run setup and diagnostics. Confirm only one intended retry trigger.
3. Push the reviewed source, create an immutable version, and deploy it with owner execution and anonymous access. Record project ID, deployment ID, version, source commit, Sheet ID, and time in private deployment notes.
4. Configure the frontend with the production `/exec` URL, retaining the reviewed validation/status behavior. The old Worker must no longer be used by the published form.
5. Set the backend ready for traffic and publish the frontend through the site's existing GitHub Pages process. Test the actual public page in signed-out Chrome and Safari using the authorized recipient. Update the verification table with evidence.

To update an existing endpoint without changing its URL:

```sh
clasp push
clasp create-version 'Describe the reviewed change'
clasp create-deployment --deploymentId EXISTING_DEPLOYMENT_ID --versionNumber VERSION_NUMBER --description 'Describe the reviewed change'
```

Retain the old Worker resource until cutover is verified; removing frontend usage does not require deleting cloud resources. The broken MailChannels path is not a functional rollback. If cutover fails, pause new submissions and display a truthful unavailable/contact message, or revert to an already verified Apps Script version. Source rollback does not reverse Script Properties or Sheet state.

## Operations, retry safety, and retention

The Sheet has one request row and separate owner/confirmation email attempt records. Short ScriptLock transitions claim work; slow sends occur outside the lock. A failed confirmation must not resend a recorded successful owner notification.

Gmail send and Sheet persistence cannot be one atomic transaction. If a send may have happened but its completion cannot be recorded, stale `sending` work becomes `needs_review`; the trigger must not blindly resend it. Exactly-once delivery is not promised.

Review `needs_review` rows privately against the owner's actual mail history. To resolve one, use the owner-only editor helper `resolveEmailReview(requestId, kind, resolution)`, where `kind` is `owner` or `confirmation`:

- `mark_sent`: use only after determining that the corresponding email was accepted/sent.
- `retry_confirmed_unsent`: use only after determining that the email was **not** sent. It allows the bounded retry processor to claim that email; it is not a generic retry for an unknown outcome.

For a one-off editor call, create a temporary owner-only function that invokes the helper with the intended request ID and run it. Remove the temporary function after recovery. Do not expose recovery functions through `doGet`/`doPost` or change a row by guessing the necessary lease fields.

Use `PAUSED=true` to stop new work during investigation and confirm the implementation's pause behavior before relying on it for pending emails. Do not delete rows, duplicate triggers, or lower leases to force retry. No emails are sent from GET requests.

Published Apps Script Workspace quotas currently list 1,500 recipient sends per day, with potentially lower trial/account limits and related Gmail limits. Quotas are shared by the account and may change; use runtime quota checks and preserve the configured buffer. These are execution limits, not new email-provider charges. [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).

No automatic retention deletion is installed. The owner should periodically review whether request and attempt records are still needed. Export privately if desired, pause processing before a coordinated cleanup, and remove corresponding request/attempt records together only after choosing a retention period. Removing a request also removes its duplicate/status history; never remove active or uncertain requests to force resubmission. Restrict editor access because owners/editors can access Script Properties and submission data.
