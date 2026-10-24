"""Live Odds Tracker's per-source comparison, with explicit timestamps and zero lines."""
from datetime import datetime

def significant_moves(rows):
    groups={}
    for row in rows:
        if not row.get('source_market_id') or not row.get('updated_at'):continue
        key=tuple(str(row.get(k)) for k in ('provider','event_id','source_market_id','bookmaker','market','selection','period','rules'))
        groups.setdefault(key,[]).append(row)
    moves=[]
    def american(price):return (price-1)*100 if price>=2 else -100/(price-1)
    for values in groups.values():
        values=sorted(values,key=lambda r:datetime.fromisoformat(r['updated_at'].replace('Z','+00:00')))
        # Conflicting observations at one source timestamp cannot establish movement.
        bytime={};conflict=False
        for r in values:
            time=datetime.fromisoformat(r['updated_at'].replace('Z','+00:00'))
            signature=(r.get('line'),float(r['decimal_price']),r.get('status'))
            if time in bytime and bytime[time]!=signature:conflict=True
            bytime[time]=signature
        if conflict or len(bytime)<2:continue
        newest=values[-1];previous=next(r for r in reversed(values) if datetime.fromisoformat(r['updated_at'].replace('Z','+00:00')) != datetime.fromisoformat(newest['updated_at'].replace('Z','+00:00')))
        if newest.get('status')!='open' or previous.get('status')!='open':continue
        line=(float(newest['line'])-float(previous['line'])) if newest.get('line') is not None and previous.get('line') is not None else None
        price=american(float(newest['decimal_price']))-american(float(previous['decimal_price']))
        if (line is not None and abs(line)>=.5) or abs(price)>=5:
            moves.append(dict(event=newest['event'],selection=newest['selection'],bookmaker=newest['bookmaker'],provider=newest['provider'],
                previous_line=previous.get('line'),current_line=newest.get('line'),american_price_change=round(price,2),line_change=line,
                observed_at=newest['updated_at'],demo=newest['provider']=='demo'))
    return sorted(moves,key=lambda r:datetime.fromisoformat(r['observed_at'].replace('Z','+00:00')),reverse=True)[:100]
