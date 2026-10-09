# EquiCurve News & Updates

`/news` is a public query surface over the canonical `IssuerPost` records. It
does not copy posts into a second feed store, and comments are never feed
entries.

## Provenance and market context

Live items are included only when the server has a verified registry record
for the canonical pool creator. Upcoming items use the durable scheduled
launch id and creator until a pool exists on-chain. Cancelled, invalidated,
launched, or otherwise unresolved schedules are excluded rather than linked by
guesswork.

Every item is labeled as a creator update. EquiCurve verifies authorship where
the canonical record supports it; it does not independently verify claims in a
post.

## Ordering

**Newest** sorts by `createdAt` descending, then `postId` descending. Pinning
never changes the global order; it only affects a market’s own Updates view.

**Popular** is a recent engagement ranking. For each post inside a rolling
seven-day window:

```text
engagement = uniqueCommenters * 4 + min(commentCount, 50)
recencyWeight = 1 / (1 + ageHours / 24)
popularScore = engagement * recencyWeight
```

Deleted comments do not count. Repeated comments from one wallet increase the
raw count but only contribute one unique commenter. Comments from the creator
count normally. Popular measures engagement, not investment quality.

If canonical comment statistics cannot be read, Popular fails closed with an
engagement-unavailable response instead of pretending every post has zero
engagement.

## Search and filters

Search is case-insensitive and covers market name, ticker, post title, and post
body. It is bounded to 2–80 characters and never searches comments. Supported
categories are All, Announcement, Update, Milestone, and Important.

Pagination uses an opaque base64url cursor containing only the deterministic
ordering key and query context. The default page is 20 items and the maximum is
50.

## Non-goals

News does not add likes, reposts, follows, DMs, creator profiles, paid
promotion, recommendations, notifications, token gates, general user posts,
scraping, or external social posts. A later production adapter can map the
same query boundary to sorted sets, secondary indexes, and post-to-comment
counters without changing the public semantics.
