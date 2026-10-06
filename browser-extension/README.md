# BuyGoods Tracking Verifier extension

Use this local Chrome/Edge extension when Vercel's verification browser gets HTTP 403. It checks the offer in an inactive background tab, so the BuyGoods tool stays on screen.

## Install once

1. Pull the latest `dev` branch so the `browser-extension` folder is current.
2. In Chrome, open `chrome://extensions`. In Edge, open `edge://extensions`.
3. Turn on **Developer mode**, choose **Load unpacked**, and select this folder.
4. Return to the Affiliate Manager tab.

## Run a check

1. Enter the offer URL and click **Verify without leaving this page**.
2. For a host that has not been approved yet, open the extensions menu (puzzle icon), choose **BuyGoods Tracking Verifier**, then click **Allow this site and verify**.
3. The extension checks the page in an inactive background tab and closes it when the result is ready. The tool page remains active.

The extension requests access separately for each host. It reads the rendered scripts, BuyGoods links, HTTP response status, and Cloudflare Ray ID when available. It does not read cookie values or send the page HTML anywhere; the results are passed to the tool page in the same browser. A site can still deny the local browser or require an interactive challenge.
