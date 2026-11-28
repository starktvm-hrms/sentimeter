/* ===== Predefined templates (built from the same elements, so they fill with each brand's data) ===== */
function T(doc) {
  const A = doc.theme.accent;
  const w = (kind, x, y, ww, hh, cfg, extra) => { const e = makeEl(kind, doc, [x, y]); e.w = ww; e.h = hh; Object.assign(e.props.cfg, cfg || {}); if (extra) Object.assign(e, extra); return e; };
  const t = (kind, x, y, ww, hh, html, p) => { const e = makeEl(kind, doc, [x, y]); e.w = ww; e.h = hh; e.props.html = html; Object.assign(e.props, p || {}); return e; };
  const box = (x, y, ww, hh, st) => { const e = makeEl("container", doc, [x, y]); e.w = ww; e.h = hh; Object.assign(e.style, st || {}); return e; };
  const img = (x, y, ww, hh, src, p) => { const e = makeEl("image", doc, [x, y]); e.w = ww; e.h = hh; e.props.src = src; Object.assign(e.props, p || {}); e.style.radius = 0; return e; };
  const page = (name, els, opt) => Object.assign(newPage(name), { elements: els }, opt || {});
  const b = SMA.brands.find(x => x.id === doc.brand);
  const logo = b && b.logo ? logoUrl(b) : "";
  const cover = (title, sub) => page("Cover", [
    box(0, 0, 794, 1123, { bg: "#17123A", radius: 0, borderW: 0 }),
    box(0, 0, 794, 560, { bg: A, radius: 0, borderW: 0 }),
    box(540, 380, 340, 340, { bg: "#FFFFFF", radius: 999, borderW: 0 }),
    ...(logo ? [img(578, 470, 200, 160, logo, { fit: "contain" })] : [t("heading", 566, 500, 212, 100, "{{brand_name}}", { color: "#17123A", align: "center", size: 24, valign: "middle", lh: 1.15 })]),
    t("text", 64, 150, 480, 30, "{{agency_name}} · {{client_name}}", { color: "#E9E3FF", size: 15, weight: 600 }),
    t("heading", 64, 196, 460, 170, title, { color: "#FFFFFF", size: 38, lh: 1.12 }),
    t("subheading", 64, 380, 460, 36, sub || "{{reporting_period}}", { color: "#FFFFFF", size: 22, weight: 500 }),
    t("text", 64, 1020, 500, 28, "Prepared on {{generated_date}}", { color: "#A9A3C9", size: 13 })
  ], { header: "hide", footer: "hide", bg: "#17123A" });
  const H = (txt, y) => t("heading", 48, y || 92, 698, 44, txt, { size: 26 });
  const kpis = (y, list, cfg) => list.map((m, i) => w("kpi", 48 + i * 178, y, 164, 118, { metric: m, ...(cfg || {}) }));
  return {
    monthly: () => ({
      period: { preset: "last_month" }, pages: [
        cover("{{report_title}}"),
        page("Executive summary", [H("Executive summary"),
          t("text", 48, 142, 698, 70, "{{brand_name}}'s social media performance for {{reporting_period}}. Summarise the highlights here: reach, engagement, audience growth and how people talked about the brand."),
          ...kpis(226, ["reach", "engagements", "engagement_rate", "followers_gained"]),
          w("line", 48, 364, 430, 290, { title: "Reach trend", metric: "reach", split: true }), w("sentiment", 492, 364, 254, 290, { title: "Sentiment" }),
          w("table", 48, 670, 698, 230, { title: "Platform-wise performance" }),
          t("text", 48, 918, 698, 80, "Key takeaways: add your commentary for the client here.", { color: "#5B5675" })]),
        page("Platforms", [H("Platform performance"), w("platcompare", 48, 146, 698, 270, { title: "Engagements by platform", metric: "engagements" }),
          w("area", 48, 430, 698, 270, { title: "Impressions / views per day", metric: "impressions", split: true }),
          w("donut", 48, 716, 340, 280, { title: "Reach share", metric: "reach" }), w("growth", 402, 716, 344, 280, { title: "Audience growth" })]),
        page("Top content", [H("Top performing posts"), w("topposts", 48, 146, 698, 380, { title: "Top posts by engagement", limit: 3 }),
          w("bar", 48, 542, 698, 270, { title: "Posts published per day", metric: "posts", mode: "daily", split: true })]),
        page("Listening", [H("Social listening"), ...kpis(146, ["mentions", "mention_reach", "positive", "net_sentiment"]),
          w("topmentions", 48, 282, 698, 360, { title: "Top mentions", limit: 4 }), w("hashtags", 48, 658, 340, 290, { title: "Top hashtags" }), w("geo", 402, 658, 344, 290, { title: "Where mentions came from" })])
      ]
    }),
    weekly: () => ({
      period: { preset: "last_7" }, pages: [
        page("Week at a glance", [H("Weekly performance · {{reporting_period}}"), ...kpis(146, ["reach", "impressions", "engagements", "followers_gained"]),
          w("line", 48, 282, 698, 300, { title: "Engagements per day", metric: "engagements", split: true }), w("table", 48, 598, 698, 220, { title: "By platform" }),
          t("text", 48, 836, 698, 120, "This week: note wins, issues and next week's plan.", { color: "#5B5675" })]),
        page("Content", [H("Top posts this week"), w("topposts", 48, 146, 698, 380, { title: "Top posts", limit: 3 }), w("sentiment", 48, 542, 340, 280), w("topmentions", 402, 542, 344, 400, { limit: 3 })])
      ]
    }),
    campaign: () => ({
      period: { preset: "last_30" }, pages: [
        cover("Campaign performance report", "Campaign #YourHashtag · {{reporting_period}}"),
        page("Campaign results", [H("Campaign results"), t("text", 48, 142, 698, 48, "Results for posts containing the campaign hashtag. Change the hashtag in each widget's Campaign setting.", { color: "#5B5675" }),
          ...kpis(204, ["posts", "reach", "engagements", "engagement_rate"], { campaign: "#YourHashtag" }),
          w("topposts", 48, 340, 698, 380, { title: "Campaign posts", campaign: "#YourHashtag", limit: 3 }),
          w("platcompare", 48, 736, 698, 250, { title: "Engagements by platform", metric: "engagements" })])
      ]
    }),
    competitor: () => ({
      period: { preset: "last_month" }, pages: [
        cover("Competitor analysis"),
        page("Followers", [H("Competitor comparison"), w("competitor", 48, 146, 698, 400, { title: "Instagram followers", net: "ig" }), w("competitor", 48, 562, 698, 400, { title: "Facebook followers", net: "fb" })]),
        page("Share of voice", [H("Share of voice"), w("sov", 48, 146, 340, 330, { title: "Instagram audience share", net: "ig" }), w("sov", 402, 146, 344, 330, { title: "Share of mentions", basis: "mentions" }),
          w("competitor", 48, 492, 698, 400, { title: "YouTube subscribers", net: "yt" })])
      ]
    }),
    sentiment: () => ({
      period: { preset: "last_month" }, pages: [
        cover("Brand sentiment report"),
        page("Sentiment", [H("Brand sentiment"), ...kpis(146, ["mentions", "positive", "negative", "net_sentiment"]),
          w("sentiment", 48, 282, 340, 300, { title: "Sentiment split" }), w("line", 402, 282, 344, 300, { title: "Mentions per day", metric: "mentions", split: false }),
          w("topmentions", 48, 598, 340, 400, { title: "Most positive", tone: "pos", limit: 3 }), w("topmentions", 402, 598, 344, 400, { title: "Most negative", tone: "neg", limit: 3 })])
      ]
    }),
    listening: () => ({
      period: { preset: "last_30" }, pages: [
        cover("Social listening report"),
        page("Overview", [H("Listening overview"), ...kpis(146, ["mentions", "mention_reach", "positive", "net_sentiment"]),
          w("area", 48, 282, 698, 280, { title: "Mentions per day", metric: "mentions" }), w("hashtags", 48, 578, 340, 300, { title: "Top hashtags" }), w("geo", 402, 578, 344, 300, { title: "Countries" })]),
        page("Conversations", [H("Top conversations"), w("topmentions", 48, 146, 698, 520, { title: "Top mentions by reach", limit: 5 }), w("sov", 48, 682, 340, 300, { title: "Share of voice", basis: "mentions" }), w("sentiment", 402, 682, 344, 300)])
      ]
    }),
    quarterly: () => ({
      period: { preset: "last_quarter" }, pages: [
        cover("Quarterly marketing report"),
        page("Quarter summary", [H("Quarter at a glance"), ...kpis(146, ["reach", "engagements", "followers_gained", "posts"]),
          w("area", 48, 282, 698, 290, { title: "Reach over the quarter", metric: "reach", split: true }), w("table", 48, 588, 698, 230, { title: "Platform-wise performance" }),
          t("text", 48, 836, 698, 120, "Quarter highlights and plans for the next quarter.", { color: "#5B5675" })]),
        page("Content & audience", [H("Content and audience"), w("topposts", 48, 146, 698, 380, { title: "Best posts of the quarter", limit: 3 }), w("growth", 48, 542, 698, 280, { title: "Audience growth" })]),
        page("Market", [H("Sentiment and competitors"), w("sentiment", 48, 146, 340, 300), w("sov", 402, 146, 344, 300, { title: "Share of voice", net: "ig" }), w("competitor", 48, 462, 698, 420, { title: "Instagram followers vs competitors", net: "ig" })])
      ]
    })
  };
}
const TEMPLATE_LIST = [["monthly", "Monthly Social Media Report", "Cover, executive summary, platforms, top content and listening."],
  ["weekly", "Weekly Performance Report", "Week at a glance and the week's top content."],
  ["campaign", "Campaign Performance Report", "Results for one campaign hashtag across platforms."],
  ["competitor", "Competitor Analysis Report", "Followers vs competitors and share of voice."],
  ["sentiment", "Brand Sentiment Report", "Sentiment split, trend, and the most positive and negative mentions."],
  ["listening", "Social Listening Report", "Mentions, reach, hashtags, countries and top conversations."],
  ["quarterly", "Quarterly Marketing Report", "Quarter summary, content, audience, sentiment and competitors."]];
function applyBuiltin(doc, key) {
  ST = ST || { doc, page: 0, sel: [] };
  const prev = ST.doc; ST.doc = doc; ST.page = 0;
  const tpl = T(doc)[key]();
  ST.doc = prev;
  doc.pages = tpl.pages; doc.period = tpl.period; doc.name = doc.name && doc.name !== "Untitled report" ? doc.name : TEMPLATE_LIST.find(x => x[0] === key)[1];
  return doc;
}
