<script lang="ts">
  // /dev/ui — every kit component in every state, with long English and Hebrew labels, for the 375px / RTL / dark checks
  // (docs/architecture.md § UI component standards). URL params: ?lang=he|en&theme=light|dark&private=1.
  // `bun run --cwd apps/web check:overflow` loads this page in headless Chrome and fails on any overflow.
  import { page } from "$app/state";
  import { I, setLang } from "#lib/i18n.svelte.ts";
  import { PV, setPrivate } from "#lib/privacy.svelte.ts";
  import {
    Area,
    Badge,
    BarList,
    Bars,
    Button,
    Card,
    Checkbox,
    Dialog,
    Drawer,
    EmptyState,
    IconButton,
    Input,
    Menu,
    Money,
    PageHeader,
    Search,
    Segmented,
    Select,
    Skeleton,
    Stat,
    Switch,
    Table,
    Tabs,
    Toaster,
    Tooltip,
    toast,
    type Column,
    type MenuItem,
  } from "#lib/ui/index.ts";

  const q = page.url.searchParams;
  setLang(q.get("lang") === "he" ? "he" : "en");
  let theme = $state(q.get("theme") ?? "light");
  $effect(() => {
    document.documentElement.dataset.theme = theme;
  });
  if (q.get("private") === "1") setPrivate(true);
  // ?open=dialog|drawer opens an overlay on load (the overflow check uses it)

  /** English or Hebrew, following the gallery language. */
  const L = (en: string, he: string) => (I.lang === "he" ? he : en);
  const LONG = $derived(L("Reconcile every uncategorized transaction for the 2025 tax year", "התאמת כל התנועות שלא סווגו בשנת המס 2025 מול דפי הבנק"));

  let seg = $state("month"),
    segIcon = $state("light"),
    tab = $state("all"),
    text = $state(""),
    amount = $state("1234.50"),
    sel = $state("osek-zair"),
    pill = $state("2025"),
    check = $state(true),
    sw = $state(false),
    search = $state(""),
    dialog = $state(q.get("open") === "dialog"),
    drawer = $state(q.get("open") === "drawer"),
    focus = $state<string | null>(null),
    picked = $state<string | null>(null);

  interface Txn {
    id: string;
    date: string;
    desc: string;
    account: string;
    amount: number;
    balance: number;
  }
  const txns: Txn[] = $derived([
    { id: "1", date: "2025-03-02", desc: L("Amazon Web Services — monthly infrastructure invoice", "אמזון שירותי ענן — חשבונית תשתית חודשית"), account: L("Software & subscriptions", "תוכנה ומנויים"), amount: -1843.27, balance: 48211.9 },
    { id: "2", date: "2025-03-05", desc: L("Client payment: Acme Holdings Ltd. (invoice #2025-031)", "תשלום מלקוח: אקמי אחזקות בע״מ (חשבונית 2025-031)"), account: L("Revenue", "הכנסות"), amount: 26305, balance: 74516.9 },
    { id: "3", date: "2025-03-09", desc: L("Bituach Leumi advance", "מקדמה לביטוח לאומי"), account: L("Uncategorized", "לא מסווג"), amount: -2150, balance: 72366.9 },
    { id: "4", date: "2025-03-14", desc: "Wolt", account: L("Meals", "ארוחות"), amount: -96.4, balance: 72270.5 },
  ]);
  const cols: Column<Txn>[] = $derived([
    { key: "date", label: L("Date", "תאריך") },
    { key: "desc", label: L("Description", "תיאור"), wrap: true },
    { key: "account", label: L("Ledger account", "חשבון בספרים") },
    { key: "amount", label: L("Amount", "סכום"), numeric: true },
    { key: "balance", label: L("Running balance", "יתרה מצטברת"), numeric: true },
    { key: "act", label: L("Actions", "פעולות"), hideLabel: true },
  ]);
  const wide: Column<Record<string, unknown>>[] = $derived(
    Array.from({ length: 12 }, (_, i) => ({ key: `m${i}`, label: new Date(2025, i, 1).toLocaleString(I.lang === "he" ? "he-IL" : "en-US", { month: "long" }), numeric: true })),
  );
  const wideRows = Array.from({ length: 30 }, (_, r) => Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`m${i}`, ((r + 1) * (i + 3) * 997.31) % 120000])));

  const months = $derived(Array.from({ length: 12 }, (_, i) => new Date(2025, i, 1).toLocaleString(I.lang === "he" ? "he-IL" : "en-US", { month: "short" })));
  const series = $derived([
    { key: "rev", label: L("Revenue", "הכנסות"), color: "var(--color-s1)" },
    { key: "cogs", label: L("Cost of goods sold", "עלות המכר"), color: "var(--color-s2)" },
    { key: "opex", label: L("Operating expenses including long category names", "הוצאות תפעול כולל שמות קטגוריה ארוכים"), color: "var(--color-s3)" },
  ]);
  const barRows = $derived(months.map((m, i) => ({ key: String(i), label: m, v: { rev: 8000 + ((i * 3517) % 9000), cogs: 1200 + ((i * 911) % 2000), opex: 2500 + ((i * 1733) % 3000) }, net: 4000 - ((i * 2311) % 7000) })));
  const menuItems: MenuItem[] = $derived([
    { label: L("Edit", "עריכה"), icon: "edit" as const, onselect: () => void (picked = "edit") },
    { label: L("Duplicate as a recurring monthly transaction", "שכפול כתנועה חודשית קבועה"), icon: "copy" as const, onselect: () => void (picked = "dup") },
    { label: L("Disabled item", "פריט מושבת"), disabled: true, onselect: () => {} },
    { label: L("Delete", "מחיקה"), icon: "trash" as const, danger: true, onselect: () => void (picked = "delete") },
  ]);
</script>

<svelte:head><title>UI kit · OpenBooks</title></svelte:head>

<div class="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
  <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2">
    <span class="me-auto text-[14px] text-ink" dir="ltr">/dev/ui</span>
    <Segmented label="Language" items={[{ key: "en", label: "English", lang: "en" }, { key: "he", label: "עברית", lang: "he" }]} value={I.lang} onchange={k => setLang(k as "en" | "he")} size="sm" />
    <Segmented
      label={L("Theme", "ערכת נושא")}
      items={[
        { key: "light", icon: "sun", title: L("Light", "בהיר") },
        { key: "dark", icon: "moon", title: L("Dark", "כהה") },
      ]}
      bind:value={theme}
      size="sm" />
    <IconButton icon={PV.on ? "eye-off" : "eye"} label={L("Privacy mode", "מצב פרטיות")} pressed={PV.on} onclick={() => setPrivate()} />
  </div>
</div>

<main data-gallery-ready class="mx-auto max-w-6xl pb-24">
  <PageHeader title={L("Page header with a very long title that has to wrap on a phone", "כותרת עמוד ארוכה מאוד שחייבת לרדת שורה בטלפון")} badge="2025" sub={L("Subtitle under the title", "כותרת משנה מתחת לכותרת")}>
    {#snippet actions()}
      <Button icon="download">{L("Export", "ייצוא")}</Button>
      <Button variant="primary" icon="plus">{L("New invoice", "חשבונית חדשה")}</Button>
      <Menu label={L("More actions", "פעולות נוספות")} items={menuItems} />
    {/snippet}
  </PageHeader>

  <div class="grid gap-4 px-4 pt-6 sm:px-8 lg:grid-cols-2">
    <Card title={L("Buttons", "כפתורים")} description={L("Variants, sizes, icons, loading, disabled, link, long labels", "סוגים, גדלים, אייקונים, טעינה, מושבת, קישור, תוויות ארוכות")}>
      <div class="flex flex-wrap items-center gap-2">
        <Button variant="primary">{L("Save", "שמירה")}</Button>
        <Button>{L("Cancel", "ביטול")}</Button>
        <Button variant="ghost">{L("Skip", "דילוג")}</Button>
        <Button variant="danger" icon="trash">{L("Delete", "מחיקה")}</Button>
        <Button size="sm" icon="upload">{L("Upload", "העלאה")}</Button>
        <Button size="lg" variant="primary" iconEnd="arrow">{L("Continue", "המשך")}</Button>
        <Button loading>{L("Syncing", "מסנכרן")}</Button>
        <Button disabled>{L("Disabled", "מושבת")}</Button>
        <Button href="#buttons" icon="external">{L("Link button", "כפתור קישור")}</Button>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" icon="check">{LONG}</Button>
        <Button size="sm">{L("Supercalifragilisticexpialidocious-accounting-reconciliation", "התאמתחשבונותארוכהמאודללארווחיםבכלל")}</Button>
      </div>
    </Card>

    <Card title={L("Icon buttons", "כפתורי אייקון")} description={L("Fixed squares; the icon always fits", "ריבועים קבועים; האייקון תמיד נכנס")}>
      <div class="flex flex-wrap items-center gap-2">
        {#each ["sm", "md", "lg"] as const as size (size)}
          <IconButton {size} icon="eye" label={L("Show amounts", "הצגת סכומים")} />
          <IconButton {size} icon="eye-off" label={L("Hide amounts", "הסתרת סכומים")} variant="secondary" />
          <IconButton {size} icon="settings" label={L("Settings", "הגדרות")} variant="primary" />
        {/each}
        <IconButton icon="eye" label={L("Privacy (pressed)", "פרטיות (לחוץ)")} pressed />
        <IconButton icon="trash" label={L("Delete", "מחיקה")} variant="danger" />
        <IconButton icon="x" label={L("Disabled", "מושבת")} disabled />
        <IconButton icon="chevron-right" label={L("Next (mirrors in RTL)", "הבא (מתהפך בעברית)")} />
      </div>
      <p class="mt-4 text-[13px] text-sub">{L("A crowded toolbar in a narrow box:", "סרגל כלים צפוף בתיבה צרה:")}</p>
      <div class="mt-2 flex w-48 max-w-full flex-wrap items-center gap-1 rounded-xl border border-line p-1">
        <Search label={L("Search transactions", "חיפוש תנועות")} bind:value={search} class="min-w-0 flex-1 basis-24" />
        <IconButton icon="eye" label={L("Privacy mode", "מצב פרטיות")} />
        <IconButton icon="filter" label={L("Filter", "סינון")} />
        <IconButton icon="sort" label={L("Sort", "מיון")} />
      </div>
    </Card>

    <Card title={L("Pills and badges", "תגיות")}>
      <div class="flex flex-wrap items-center gap-2">
        {#each ["neutral", "accent", "good", "warn", "bad"] as const as tone (tone)}
          <Badge {tone}>{tone}</Badge>
        {/each}
        <Badge tone="good" icon="tick">{L("Reconciled", "הותאם")}</Badge>
        <Badge size="sm" shape="tag">{L("Draft", "טיוטה")}</Badge>
        <Badge tone="accent" icon="sparkle">{L("Best value", "הכי משתלם")}</Badge>
      </div>
      <p class="mt-4 text-[13px] text-sub">{L("Squeezed next to a long title (the title wraps, the pill doesn't):", "לצד כותרת ארוכה (הכותרת יורדת שורה, התגית לא):")}</p>
      <div class="mt-2 flex w-56 max-w-full items-start gap-2">
        <span class="min-w-0 text-[14px] text-ink">{LONG}</span>
        <Badge tone="good">{L("Best value", "הכי משתלם")}</Badge>
      </div>
      <p class="mt-4 text-[13px] text-sub">{L("Plan cards:", "כרטיסי מסלול:")}</p>
      <div class="mt-2 flex flex-wrap gap-2">
        {#each [L("Osek patur", "עוסק פטור"), L("Osek zair (small business)", "עוסק זעיר (עסק קטן)"), L("Osek murshe", "עוסק מורשה")] as name, i (name)}
          <div class="w-44 rounded-xl border border-line p-3">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="min-w-0 text-[14px] text-ink">{name}</span>
              {#if i === 1}<Badge tone="good">{L("Best value", "הכי משתלם")}</Badge>{/if}
            </div>
            <Money value={[12450, 9870.5, 15230][i] ?? 0} cents={false} class="mt-1 block text-[18px] text-ink" />
          </div>
        {/each}
      </div>
    </Card>

    <Card title={L("Segmented controls", "בוררים")}>
      <div class="flex flex-col items-start gap-3">
        <Segmented
          label={L("Period", "תקופה")}
          items={[
            { key: "month", label: L("Month", "חודש") },
            { key: "quarter", label: L("Quarter", "רבעון") },
            { key: "year", label: L("Year", "שנה") },
          ]}
          bind:value={seg} />
        <Segmented
          label={L("Theme", "ערכת נושא")}
          items={[
            { key: "light", icon: "sun", title: L("Light", "בהיר") },
            { key: "dark", icon: "moon", title: L("Dark", "כהה") },
            { key: "auto", icon: "monitor", title: L("System", "מערכת") },
          ]}
          bind:value={segIcon} />
        <Segmented
          label={L("Long options", "אפשרויות ארוכות")}
          items={[
            { key: "month", label: L("This calendar month to date", "החודש הקלנדרי עד היום") },
            { key: "quarter", label: L("Previous fiscal quarter", "הרבעון הפיסקלי הקודם") },
            { key: "year", label: L("Entire tax year 2025", "כל שנת המס 2025"), icon: "calendar" },
          ]}
          bind:value={seg} />
      </div>
    </Card>

    <Card title={L("Tabs", "לשוניות")} class="lg:col-span-2">
      <Tabs
        label={L("Transaction filters", "סינון תנועות")}
        items={[
          { key: "all", label: L("All transactions", "כל התנועות"), count: 1284 },
          { key: "review", label: L("Needs review", "לבדיקה"), count: 37 },
          { key: "in", label: L("Money in", "כסף נכנס") },
          { key: "out", label: L("Money out", "כסף יוצא") },
          { key: "uncat", label: L("Uncategorized expenses", "הוצאות שלא סווגו"), count: 5 },
          { key: "split", label: L("Split transactions", "תנועות מפוצלות") },
        ]}
        bind:value={tab}>
        {#snippet children(k)}<p class="pt-3 text-[14px] text-sub">{L("Panel for", "לשונית")} “{k}”</p>{/snippet}
      </Tabs>
    </Card>

    <Card title={L("Money and stats", "סכומים ונתונים")} class="lg:col-span-2">
      <div class="grid gap-6 sm:grid-cols-3">
        <Stat label={L("Net profit, year to date", "רווח נקי מתחילת השנה")} value={184320.55} delta={0.124} hint={L("12 months", "12 חודשים")} />
        <Stat label={L("Expenses", "הוצאות")} value={-98450} delta={-0.032} invert size="md" currency="USD" />
        <Stat label={L("Transactions", "תנועות")} value={1284} raw size="md" />
      </div>
      <p class="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[15px] text-ink">
        <Money value={1234.56} />
        <Money value={-1234.56} tone="auto" />
        <Money value={0} />
        <Money value={12345678.9} currency="USD" />
        <Money value={250} plus tone="auto" />
        <Money value={99.99} cents={false} currency="EUR" />
      </p>
      <p class="mt-2 text-[14px] text-ink-2">
        {L("Inside a sentence:", "בתוך משפט:")}
        {L("You owe", "עליך לשלם")} <Money value={-4210.3} /> {L("to Bituach Leumi by March 15.", "לביטוח לאומי עד 15 במרץ.")}
      </p>
    </Card>

    <Card title={L("Table", "טבלה")} description={L("Scrolls inside its own box; numbers end-aligned", "נגללת בתוך המסגרת; מספרים מיושרים לסוף")} flush class="lg:col-span-2">
      <Table columns={cols} rows={txns} key={r => r.id} caption={L("Transactions", "תנועות")} onrowclick={r => (picked = r.id)} selected={r => r.id === picked}>
        {#snippet cell(r, c)}
          {#if c.key === "amount"}<Money value={r.amount} tone="auto" />
          {:else if c.key === "balance"}<Money value={r.balance} />
          {:else if c.key === "date"}<span class="num">{r.date}</span>
          {:else if c.key === "account"}{#if r.account === L("Uncategorized", "לא מסווג")}<Badge tone="warn">{r.account}</Badge>{:else}{r.account}{/if}
          {:else if c.key === "desc"}<span dir="auto">{r.desc}</span>
          {:else}<Menu label={L("Row actions", "פעולות לשורה")} items={menuItems} />{/if}
        {/snippet}
        {#snippet foot()}
          <tr><td colspan="3">{L("Total", "סה״כ")}</td><td class="text-end"><Money value={txns.reduce((a, t) => a + t.amount, 0)} /></td><td></td><td></td></tr>
        {/snippet}
      </Table>
    </Card>

    <Card title={L("Wide table, sticky header", "טבלה רחבה, כותרת דביקה")} flush>
      <Table columns={wide} rows={wideRows} maxHeight="280px" caption={L("Monthly totals", "סיכומים חודשיים")}>
        {#snippet cell(r, c)}<Money value={Number(r[c.key])} cents={false} />{/snippet}
      </Table>
    </Card>

    <Card title={L("Empty table", "טבלה ריקה")} flush>
      <Table columns={cols} rows={[]}>
        {#snippet empty()}<EmptyState compact icon="list" title={L("No transactions match these filters", "אין תנועות שמתאימות לסינון")} />{/snippet}
      </Table>
    </Card>

    <Card title={L("Form fields", "שדות טופס")}>
      <div class="grid gap-4">
        <Input label={L("Business name", "שם העסק")} bind:value={text} placeholder={L("e.g. Acme Ltd.", "לדוגמה: אקמי בע״מ")} hint={L("As it appears on invoices", "כפי שמופיע בחשבוניות")} required />
        <Input label={L("Amount", "סכום")} bind:value={amount} numeric icon="wallet" />
        <Input label={L("VAT number", "מספר עוסק")} value="12345" error={L("A VAT number has 9 digits — this one has 5", "למספר עוסק יש 9 ספרות — כאן יש 5")} numeric />
        <Input label={LONG} disabled value={L("Disabled", "מושבת")} />
        <Select
          label={L("Business type", "סוג עסק")}
          bind:value={sel}
          options={[
            { value: "osek-patur", label: L("Osek patur (exempt dealer)", "עוסק פטור") },
            { value: "osek-zair", label: L("Osek zair (small business, 30% expense deduction)", "עוסק זעיר (ניכוי הוצאות של 30%)") },
            { value: "ltd", label: L("Ltd. company", "חברה בע״מ") },
          ]}
          hint={L("You can change this per tax year", "אפשר לשנות לכל שנת מס")} />
        <Select label={L("Country", "מדינה")} error={L("Pick a country", "יש לבחור מדינה")} options={[{ value: "", label: "—" }]} />
      </div>
    </Card>

    <Card title={L("Choices", "בחירות")}>
      <div class="grid gap-4">
        <div class="flex flex-wrap items-center gap-2">
          <Select
            variant="pill"
            icon="calendar"
            label={L("Tax year", "שנת מס")}
            bind:value={pill}
            options={["2023", "2024", "2025"].map(y => ({ value: y, label: L(`Tax year ${y}`, `שנת המס ${y}`) }))} />
          <Select variant="pill" label={L("Account", "חשבון")} value="a" options={[{ value: "a", label: L("One Zero business checking ••4821", "וואן זירו עסקי ••4821") }]} />
        </div>
        <Checkbox label={L("Include personal accounts", "כולל חשבונות פרטיים")} bind:checked={check} />
        <Checkbox label={LONG} description={L("A description under a long label wraps too.", "גם תיאור מתחת לתווית ארוכה יורד שורה.")} />
        <Checkbox label={L("Some selected", "חלק נבחרו")} indeterminate />
        <Checkbox label={L("Disabled", "מושבת")} disabled />
        <Switch label={L("Sync banks every morning", "סנכרון הבנקים כל בוקר")} bind:checked={sw} description={L("Runs while OpenBooks is open", "פועל כש-OpenBooks פתוח")} />
        <Switch label={LONG} checked />
        <Switch label={L("Disabled", "מושבת")} disabled />
      </div>
    </Card>

    <Card title={L("Overlays", "חלונות")} description={picked ? `${L("Picked", "נבחר")}: ${picked}` : undefined}>
      <div class="flex flex-wrap items-center gap-2">
        <Button onclick={() => (dialog = true)}>{L("Open dialog", "פתיחת חלון")}</Button>
        <Button onclick={() => (drawer = true)}>{L("Open drawer", "פתיחת מגירה")}</Button>
        <Menu label={L("Actions menu", "תפריט פעולות")} text={L("Actions", "פעולות")} icon="settings" items={menuItems} align="start" />
        <Menu label={L("More", "עוד")} items={menuItems} />
        <Tooltip text={L("Amounts are inflated 3–9× so screenshots don't leak your numbers.", "הסכומים מנופחים פי 3–9 כדי שצילומי מסך לא יחשפו את המספרים.")}>
          <IconButton icon="info" label={L("About privacy mode", "על מצב פרטיות")} />
        </Tooltip>
        <Button onclick={() => toast(L("Saved", "נשמר"))}>{L("Toast", "הודעה")}</Button>
        <Button
          onclick={() =>
            toast(L("Categorized 12 transactions as Software & subscriptions", "12 תנועות סווגו כתוכנה ומנויים"), {
              action: { label: L("Create rule", "יצירת כלל"), value: "AWS", run: v => (picked = `rule:${v}`) },
            })}>{L("Toast with action", "הודעה עם פעולה")}</Button>
        <Button variant="danger" onclick={() => toast(L("Sync failed: the bank asked for a new one-time code", "הסנכרון נכשל: הבנק ביקש קוד חד-פעמי חדש"), { tone: "bad" })}
          >{L("Error toast", "הודעת שגיאה")}</Button>
      </div>
    </Card>

    <Card title={L("Empty and loading", "ריק וטעינה")}>
      <EmptyState icon="folder" title={L("No documents yet", "עדיין אין מסמכים")} text={L("Drop statements and receipts here, or connect a bank to sync them.", "גררו לכאן דפי חשבון וקבלות, או חברו בנק לסנכרון.")} compact>
        <Button variant="primary" icon="upload">{L("Upload", "העלאה")}</Button>
        <Button icon="bank">{L("Connect a bank", "חיבור בנק")}</Button>
      </EmptyState>
      <div class="mt-4 grid gap-3">
        <Skeleton height="28px" width="40%" />
        <Skeleton lines={3} />
        <div class="flex items-center gap-3"><Skeleton round width="32px" height="32px" /><Skeleton width="60%" /></div>
      </div>
    </Card>

    <Card title={L("Bars", "עמודות")} class="lg:col-span-2">
      <Bars label={L("Revenue and expenses by month, 2025", "הכנסות והוצאות לפי חודש, 2025")} rows={barRows} {series} line={{ key: "net", label: L("Net", "נטו"), color: "var(--color-ink)" }} bind:focus />
    </Card>

    <Card title={L("Grouped bars", "עמודות מקובצות")}>
      <Bars label={L("Grouped", "מקובץ")} rows={barRows.slice(0, 6)} {series} layout="group" height={200} bind:focus />
    </Card>

    <Card title={L("Bar list and area", "רשימה ושטח")}>
      <BarList items={series.map((s, i) => ({ key: s.key, label: s.label, value: [96000, 18000, 41250][i] ?? 0, color: s.color }))} bind:focus onselect={k => (picked = k)} />
      <div class="mt-6">
        <Area label={L("Cash balance", "יתרת מזומנים")} points={barRows.map(r => ({ label: r.label, v: r.v.rev - r.v.opex }))} valueLabel={L("Cash", "מזומן")} />
      </div>
    </Card>
  </div>
</main>

<Dialog
  bind:open={dialog}
  title={L("Delete 12 transactions imported from the March 2025 One Zero statement?", "למחוק 12 תנועות שיובאו מדף החשבון של וואן זירו ממרץ 2025?")}
  description={L("The statement file stays in your inbox; you can re-import it.", "קובץ הדף נשאר בתיבה; אפשר לייבא אותו שוב.")}>
  <Input label={L("Type DELETE to confirm", "הקלידו DELETE לאישור")} />
  {#snippet actions()}
    <Button onclick={() => (dialog = false)}>{L("Cancel", "ביטול")}</Button>
    <Button variant="danger" onclick={() => (dialog = false)}>{L("Delete transactions", "מחיקת התנועות")}</Button>
  {/snippet}
</Dialog>

<Drawer bind:open={drawer} title={L("Transaction details: Amazon Web Services monthly infrastructure invoice", "פרטי תנועה: חשבונית תשתית חודשית של אמזון")}>
  {#snippet actions()}<Menu label={L("More", "עוד")} items={menuItems} />{/snippet}
  <div class="grid gap-4 p-4 sm:p-5">
    <Money value={-1843.27} class="text-[28px] text-ink" />
    <Select label={L("Ledger account", "חשבון בספרים")} value="sw" options={[{ value: "sw", label: L("Software & subscriptions", "תוכנה ומנויים") }]} />
    <Input label={L("Notes", "הערות")} />
  </div>
  {#snippet footer()}
    <Button onclick={() => (drawer = false)}>{L("Close", "סגירה")}</Button>
    <Button variant="primary" onclick={() => (drawer = false)}>{L("Save", "שמירה")}</Button>
  {/snippet}
</Drawer>

<Toaster />
