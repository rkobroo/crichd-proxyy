[![Build APK](https://github.com/rkobroo/Tv/actions/workflows/android.yml/badge.svg)](https://github.com/rkobroo/Tv/actions/workflows/android.yml)

## Live Sports TV (Video.js + IPTV-orgg)

A minimal web app that fetche and parsees the `sports.m3u` playlist from `iptv-org/iptv` and lets you play HLS (`.m3u8`) live TV channels with Video.js.

- Source playlist: `https://raw.githubusercontent.com/iptv-org/iptv/main/categories/sports.m3u`
- Player: Video.js (via CDN)
- Focus: Sports channels (useful for Nepal users, e.g., cricket)

### Features
- Fetch and parse M3U playlist (channel name + HLS URL)
- Dropdown to choose channels; plays with Video.js
- Nepal-first sorting (NP → IN → BD → PK → LK → BT)
- Basic error handling with alerts
- CORS fallback options (local file or your own proxy)

### Legal & License
- Uses channel lists from `iptv-org/iptv` under the MIT License. See the repository: `https://github.com/iptv-org/iptv`.
- Only use streams you are legally allowed to watch in your region. You are responsible for complying with all applicable laws and content rights.

---

## Note

This repository includes a serverless HLS proxy and LL-HLS playlist rewrites to improve playback compatibility.
