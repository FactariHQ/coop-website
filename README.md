# coop.factari.com

Public website for Factari CoOp. Plain static HTML, CSS and JS — no build step.
Served by GitHub Pages from the `main` branch root; the `CNAME` file sets the custom domain.

- Pages: `/index.html` plus one folder per route (`/start/`, `/grow/`, `/clinical-commons/` …)
- Forms (assessment, contact) post to the Google Apps Script endpoint set in each page's `window.COOP_SUBMIT_ENDPOINT`
- Analytics: Plausible (`data-domain="coop.factari.com"`)
- DNS: `coop` CNAME → `factarihq.github.io` (Squarespace Domains, factari.com zone)
