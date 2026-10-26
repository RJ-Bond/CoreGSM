# End-to-end scenarios

- ok: 1 sign-in: a wrong password is refused, the right one opens the panel (1732 ms)
- FAIL: 2 add a server in the admin form (31406 ms) - locator.fill: Timeout 30000ms exceeded.
- ok: 3 publish news: queued for the bot, then visible to everyone (1018 ms)
- ok: 4 comment under the news item from the page (1052 ms)
- ok: 5 report a comment: a player flags it, a moderator sees it in the queue (233 ms)
- ok: 6 report a player: the complaint reaches the moderators (5 ms)
- ok: 7 the public and admin pages open without script errors (12730 ms)
