# BuyGoods Tracking Verifier extension

Use this Chrome/Edge extension when the hosted verifier receives HTTP 403. It opens the offer in an inactive background tab, checks the rendered tracking code and checkout links, then returns the results to the BuyGoods tool while leaving the tool tab active.

## Install or reload

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this `browser-extension/` folder.
4. Accept the browser's initial request for access to all sites.

The extension will not request permission separately for each site. Chrome/Edge still require you to approve the initial extension installation and its requested access. The verifier does not read cookie values or send page HTML or postback URLs to the tool server. It returns the tracking checks, test response, status code, and Cloudflare Ray ID to the open tool tab.

If the verifier says the browser blocked script inspection, open the extension's **Details → Site access** and choose **On all sites**, then reload the extension. If access is already enabled, another browser privacy/ad-blocking extension or local network filter may be blocking the target page.
