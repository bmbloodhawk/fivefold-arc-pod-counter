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
- Complete a game. Have the guest dismiss the post-game screens first, then the host. Both phones should reach next-game setup without a connection warning.
- Start a second game, then leave the table and create a new pod.

Record the staging URL, commit SHA, phones/browsers, pass/fail result, and any
connection banner or error text. A failed item blocks public deployment.

## Room recovery restart test

1. Open staging on both phones and confirm **TEST ENVIRONMENT**. Start a fresh
   two-player game. Set the two life totals to 37 and 35 and verify both phones
   show them.
2. In staging **Developer Space → Diagnostics → Room recovery**, enter the room
   code and select **Check save**. Record the last successful save time and
   saved version. Check again until the saved version matches the live version.
   If the save cannot be verified, resolve that before the restart.
3. Confirm no other staging tables are in use. With both phones still on the
   table, select **Manual Deploy → Restart service** for
   **fivefold-arc-pod-counter-staging** in Render. Use the staging deploy event
   to confirm the restart and wait for
   [staging health](https://fivefold-arc-pod-counter-staging.onrender.com/health).
4. Check that both phones return to their own seats at the same room with life
   totals 37 and 35. Change one total by 1 and check that both phones show the
   same result once. Select **Check save** again and verify a fresh confirmed
   save for the resulting version.
5. Record the build, phones and browsers, saved versions, restored scores, and
   any reconnect message. If either phone gets a different state, preserve the
   room and its diagnostics for review.
