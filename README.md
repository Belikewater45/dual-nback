# Dual N-Back (Brain Workshop rules, for Android)

An offline web app that you install on the home screen of the Galaxy Tab S6 Lite and the Pixel 7a. Your history syncs between the two devices through a private GitHub Gist.

## One-time setup (on your Windows PC, about 10 minutes)

1. **Create a free GitHub account** at https://github.com/signup.
2. **Create a repository.** Click **+** (top right), then **New repository**. Name it `dual-nback` and set it to **Public**. GitHub Pages is free only for public repos. Only the app's code is public; your scores are stored in a secret Gist, not in the repo. Click **Create repository**.
3. **Upload the app.** On the new repo page, click **uploading an existing file**. Unzip `dual-nback.zip`, select everything *inside* the `dual-nback` folder (index.html, app.js, the `sounds`, `music`, `img` and `icons` folders, etc.) and drag it onto the page. Then click **Commit changes**.
4. **Turn on GitHub Pages.** Go to **Settings**, then **Pages**. Under Source choose **Deploy from a branch**, set Branch to **main** and the folder to **/ (root)**, then click **Save**. After about 1 minute the page shows your address: `https://YOUR-USERNAME.github.io/dual-nback/`.
5. **Create the sync token.** Click your profile photo, then **Settings**, **Developer settings**, **Personal access tokens**, **Tokens (classic)** and **Generate new token (classic)**. Give it a note such as "dual n-back", pick an expiration (*No expiration* means you never have to redo it), tick **only `gist`**, and generate it. Copy the token (it starts with `ghp_`). This token can read and write your Gists and nothing else.

## On each device (tablet and phone)

1. Open `https://YOUR-USERNAME.github.io/dual-nback/` in **Chrome** while you have signal.
2. Open Chrome's **⋮** menu and tap **Add to home screen**, then **Install**.
3. Open the app from the home screen, go to **Settings**, then **Sync between devices**. Paste the token and tap **Connect**.

After that, the app works with no signal at all. Each finished session is saved on the device immediately. The next time either device has signal (when you open the app, finish a session, or tap the sync label at the top), it merges with the other device. Sessions are never lost or duplicated, even if you train on both devices while offline.

## Bringing over your Brain Workshop history

On the PC, find Brain Workshop's `stats.txt` in its data folder. Send it to one of the devices (email, Quick Share, etc.). In the app, open **Stats**, tap **Import file…** and pick `stats.txt`. Dual N-Back sessions are imported and duplicates are skipped. The import then syncs to the other device.

## Updating the app later

Upload the changed files to the same repo the same way. Each device picks up the new version the next time it opens the app with signal.

## Controls

- Tap **A / position** when the square is in the same place as N trials ago.
- Tap **L / audio** when the letter is the same as N trials ago.
- A keyboard also works: A, L, Space to start, Esc to stop.
- **Stop** pauses the session (Resume or Quit). Switching apps also pauses it. A quit session is not saved, the same as in Brain Workshop.

## Credits

The game rules were ported line-for-line from Brain Workshop (`brainworkshop.py`). The letter sounds, square sprite and music also come from Brain Workshop (GPL-2.0, https://github.com/brain-workshop/brainworkshop). This port is GPL-2.0 as well.
