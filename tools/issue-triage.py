"""Sorts the open issues left in finished milestones (docs/plans/issue-triage-2026-11-21.md).

A record of how that page's table was made, kept so that it can be made
again. It is not part of `make check`.

    gh api "repos/OWNER/REPO/issues?state=open&per_page=100" --paginate \
      --jq '.[]|select(.pull_request|not)|{n:.number,m:(.milestone.title//"none"),l:[.labels[].name],t:.title,b:.body}' \
      > /tmp/open.jsonl
    python3 tools/issue-triage.py .

It reads /tmp/open.jsonl and writes /tmp/triage_out.json: the table's rows
and the list of (issue, milestone) to set. It changes nothing on GitHub.
"""
import json,re,collections,sys
root=sys.argv[1]
story={}
for line in open(root+'/docs/requirements/user-stories.md'):
    m=re.match(r'\| (US-[A-Z]\d+) \| .* \| (M\d) \| \[#(\d+)\]', line)
    if m: story[m.group(1)]=(m.group(2), int(m.group(3)))
rows=[json.loads(l) for l in open('/tmp/open.jsonl')]
out=[]
for r in rows:
    body=r['b'] or ''
    loc=re.search(r'\*\*Location:\*\*(.*)', body)
    text=(loc.group(1) if loc else '')+' '+r['t']
    ids=sorted(set(re.findall(r'US-[A-Z]\d+', text)))
    # short forms like B3.6, C14.2, D7.5 in the location
    for m in re.findall(r'\b([BCD])(\d+)\.\d+', text):
        ids.append(f'US-{m[0]}{m[1]}')
    if not ids:
        ids=sorted(set(re.findall(r'US-[A-Z]\d+', body)))
        src='body'
    else: src='location'
    ids=sorted(set(i for i in ids if i in story))
    ms=sorted(set(story[i][0] for i in ids))
    later=[m for m in ms if m>='M3']
    target=later[0] if later else ('M2-done' if ms else 'none')
    out.append((r['n'],r['m'],target,src,ids,r['t'],r['l']))
json.dump(out,open('/tmp/triage.json','w'))
c=collections.Counter(o[2] for o in out); print(c)

# ---- second half: the table and the changes
HAND={
 6:("now","the maintainer's, on the decisions page"),
 7:("now","the maintainer's; what is still open is on the decisions page"),
 10:("M4","US-C1: criteria 6 to 8 (a tenant that is not answering, the dashboard's list, the emails) are not built; criteria 4 and 9 await the maintainer"),
 11:("check","US-C2: built in M2; the maintainer checks the criteria and closes"),
 104:("M6","how the NFRs are shown to be met"),108:("M6","numbers with one home"),109:("M6","the load test's environment"),
 105:("docs","risk rows"),106:("docs","criteria that bundle behaviours"),116:("docs","wording"),117:("docs","low findings on the requirements' text"),245:("docs","one sentence of the architecture"),
 133:("M4","the holding message"),135:("M5","quiet hours when the business messages first"),142:("M4","sending while a tenant is not answering"),143:("M4","handover states"),
 162:("M6","roles are separate (M2); key rotation is not planned"),163:("M6","CI and supply chain"),276:("M6","CI and document checks"),279:("M6","the database unit's leftovers: images pinned by digest, the bootstrap's limits"),
 165:("M3","the guard for a fake model client; it stays open after M3 for logged email (M4)"),
 178:("M4","channel credentials set from the dashboard"),191:("M4","the cross-tenant role and dashboard sign-in"),204:("M4","names in the API and the data model"),
 195:("M5","release of held messages"),285:("M5","templates and the channel's leftovers"),
 200:("M3","the pack interface has no ADR"),237:("M3","pack hooks, due with the steps that need them"),278:("M3","shared lists; the handover reasons a pack may add"),
 282:("M4","delivering an operator alert"),284:("M3","who a customer is: awaits the maintainer"),288:("M3","sessions, the batching window"),290:("M3","the worker's leftovers"),293:("M4","the owner's invitation; tenant state"),295:("M3","the guard and the pack, continued"),
}
lines=[]; changes=[]
for n,m,target,src,ids,title,labels in sorted(out):
    cur=m.split()[0] if m!="none" else "none"
    if cur in ("M3","M4","M5","M6","v1.1"):
        continue
    if n in HAND:
        to,why=HAND[n]; basis="by hand: "+why
    elif target in ("M3","M4","M5","M6"):
        to=target; basis="names "+", ".join(ids)
    else:
        to="?"; basis="not placed"
    t=title.replace("|","/")
    t=(t[:88]+"…") if len(t)>90 else t
    lines.append(f"| #{n} | {cur} | {to} | {basis} | {t} |")
    if to in ("M3","M4","M5","M6"): changes.append((n,to))
json.dump({"lines":lines,"changes":changes},open('/tmp/triage_out.json','w'))
c=collections.Counter(l.split(" | ")[2] for l in lines); print(len(lines), dict(c))
