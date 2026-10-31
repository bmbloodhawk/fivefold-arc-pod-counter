# Staging release gate

The staging URL is the only remote target for unfinished work. Never point the
black-box suite at the public app.

## Before a phone test

1. Confirm the page displays **TEST ENVIRONMENT**.
2. Check `https://fivefold-arc-pod-counter-staging.onrender.com/health`.
3. Run the deployed protocol suite:

   ```powershell
   $env:QA_BASE_URL = 'https://fivefold-arc-pod-counter-staging.onrender.com'
   npm --prefix qa run test:live
   ```

4. Create a fresh staging pod. Do not reuse a public pod code.

## Two-phone release script

Run this on the staging URL before requesting a public release:

- Create a two-player Commander pod and join from a second phone.
- Change life on each phone; confirm the other phone updates within two seconds.
- Record commander damage, including 21 commander damage and life at zero.
- Eliminate the host and a non-host in separate games.
- Put one phone in the background for 30 seconds, return, and make one change from each phone.
- Refresh one phone while the other stays in the pod; confirm both still converge.
- Complete a game and walk through every post-game screen.
- Start a second game, then leave the table and create a new pod.

Record the staging URL, commit SHA, phones/browsers, pass/fail result, and any
connection banner or error text. A failed item blocks public deployment.
