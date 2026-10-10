# Privacy

The node sends the selected image URLs, action parameters and API token to `https://api.acedata.cloud/face/*`. Ace Data Cloud processes the images and returns analysis data or an image URL. The node does not fetch the input images itself, contact another host, read local files or environment variables, or add telemetry. n8n stores the token in its credential store; workflow exports should never include it. Process only images you are authorized to use.

See the [Ace Data Cloud privacy policy](https://platform.acedata.cloud/privacy) and [current Face Transform service details](https://platform.acedata.cloud/models).
