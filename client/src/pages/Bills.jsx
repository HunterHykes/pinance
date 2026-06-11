import { useState, useMemo, useRef, useEffect } from 'react'
import { TrendingUp, Scissors } from 'lucide-react'
import RowMoreMenu from '../components/RowMoreMenu'
import {
  useBills, useCreateBill, useUpdateBill,
  useDeleteBill,
} from '../hooks/useBills'
import { useBudget, useSaveBudgetCategory } from '../hooks/useBudget'
import { useAccounts } from '../hooks/useAccounts'
import { formatCurrency, currentMonth, resolveColor } from '../utils'
import TreeSelect from '../components/TreeSelect'
import ColorPicker from '../components/ColorPicker'
import ChangeIntentModal from '../components/ChangeIntentModal'
import RecurringRulePanel from '../components/RecurringRulePanel'
import { MonthPicker } from '../components/DateRangePicker'
import { CurrencyInput, DateInput } from '../components/FormControls'

const FREQUENCIES = [
  { value: 'monthly',     label: 'Monthly' },
  { value: 'quarterly',   label: 'Quarterly' },
  { value: 'semi_annual', label: 'Semi-Annual' },
  { value: 'annual',      label: 'Annual' },
]
const REC_COLS = 'minmax(0,1fr) minmax(100px,140px) minmax(80px,100px) minmax(80px,100px) minmax(80px,100px) 36px'
const RULE_COLUMNS = '2fr 130px 140px 130px 24px 110px 48px'
const RULE_HEADERS = ['Label', 'Started on', 'Frequency', 'Account', '', 'Amount', '']

function freqLabel(f) { return FREQUENCIES.find(x => x.value === f)?.label || f }

function monthlyEquivalent(charges) {
  return charges.filter(c => !c.effective_to).reduce((sum, c) => {
    switch (c.frequency) {
      case 'monthly':     return sum + c.amount
      case 'quarterly':   return sum + c.amount / 3
      case 'semi_annual': return sum + c.amount / 6
      case 'annual':      return sum + c.amount / 12
      default:            return sum
    }
  }, 0)
}

function chargeOccursInMonth(anchorDate, frequency, targetMonth) {
  const anchor = new Date(anchorDate + 'T00:00:00')
  const [ty, tm] = targetMonth.split('-').map(Number)
  switch (frequency) {
    case 'monthly': return true
    case 'quarterly': { const am = anchor.getFullYear()*12+anchor.getMonth(), bm=ty*12+(tm-1); return (bm-am)%3===0&&bm>=am }
    case 'semi_annual': { const am = anchor.getFullYear()*12+anchor.getMonth(), bm=ty*12+(tm-1); return (bm-am)%6===0&&bm>=am }
    case 'annual': return anchor.getMonth()===(tm-1)&&ty>=anchor.getFullYear()
    default: return false
  }
}

const defaultCharge = (startedOn) => ({
  label: '', amount: '', frequency: 'monthly',
  anchor_date: startedOn || new Date().toISOString().slice(0,10),
  effective_from: startedOn || new Date().toISOString().slice(0,10),
})

function ChargeRuleRow({ charge, index, onChange, onRemove, canRemove, started_on, accounts, allCharges, siblingCharges }) {
  const [showHist, setShowHist] = useState(false)
  const isExisting = !!charge.id; const isDirty = isExisting && charge._dirty
  const set = (field, val) => onChange(index, { ...charge, [field]: val })
  const labelTrimmed = charge.label?.trim() || ''
  const isDupLabel = labelTrimmed !== '' && (siblingCharges||[]).some((c,i)=>i!==index&&(c.label?.trim()||'')===labelTrimmed)
  const handleFreqChange = (freq) => { const a = freq==='monthly'?(started_on||charge.anchor_date):charge.anchor_date; onChange(index,{...charge,frequency:freq,anchor_date:a}) }
  const itemHist = useMemo(()=>(!charge.budget_category_id||!allCharges)?[]:allCharges.filter(c=>c.budget_category_id===charge.budget_category_id),[charge.budget_category_id,allCharges])
  return (
    <>
      <div style={{ display:'grid',gridTemplateColumns:RULE_COLUMNS,gap:'6px',alignItems:'center',padding:'6px 0',borderBottom:'1px solid var(--border)',background:isDirty?'rgba(59,130,246,0.04)':'transparent' }}>
        <div style={{position:'relative'}}>
          <input type="text" value={charge.label} onChange={e=>set('label',e.target.value)} placeholder="Label" required style={{fontSize:'13px',borderColor:isDupLabel?'var(--red)':undefined,outline:isDupLabel?'1px solid var(--red)':undefined,width:'100%'}} />
          {isDupLabel&&<span style={{position:'absolute',top:'100%',left:0,fontSize:'10px',color:'var(--red)',whiteSpace:'nowrap',marginTop:'1px'}}>Duplicate label</span>}
        </div>
        <DateInput value={charge.anchor_date||started_on||''} onChange={v=>set('anchor_date',v)} />
        <select value={charge.frequency} onChange={e=>handleFreqChange(e.target.value)} style={{fontSize:'13px'}}>{FREQUENCIES.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}</select>
        <select value={charge.account_id||''} onChange={e=>set('account_id',e.target.value||null)} style={{fontSize:'13px'}}><option value="">—</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <div style={{display:'flex',justifyContent:'center'}}>{isExisting&&itemHist.length>1&&<button type="button" className={`btn-trend${showHist?' btn-trend--active':''}`} onClick={()=>setShowHist(h=>!h)} title="History"><TrendingUp size={12}/></button>}</div>
        <CurrencyInput value={charge.amount} onChange={v=>set('amount',v)} placeholder="0.00" required inputStyle={{fontSize:'13px'}} />
        <div style={{display:'flex',justifyContent:'center'}}>{canRemove&&<button type="button" className="btn-icon-remove" onClick={()=>onRemove(index)} title="Remove"><span style={{fontSize:'16px',lineHeight:1}}>−</span></button>}</div>
      </div>
      {showHist&&itemHist.length>0&&(
        <div style={{padding:'4px 0 8px',borderBottom:'1px solid var(--border)'}}>
          {[...itemHist].sort((a,b)=>b.effective_from.localeCompare(a.effective_from)).map(c=>(
            <div key={c.id} className="sub-history-row">
              <span style={{color:c.effective_to?'var(--text-tertiary)':'var(--text)'}}>{c.label} — {formatCurrency(c.amount)} / {freqLabel(c.frequency)}</span>
              <span style={{fontSize:'11px',color:'var(--text-tertiary)'}}>{new Date(c.effective_from+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}{c.effective_to?` → ${new Date(c.effective_to+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`:' → present'}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function BillModal({ initial, categories, accounts, onClose, onSave, loading }) {
  const [name,        setName]        = useState(initial?.name || '')
  const [description, setDescription] = useState(initial?.description || initial?.notes || '')
  const [parentCatId, setParentCatId] = useState(initial?.parent_category_id || null)
  const [color,       setColor]       = useState(initial?.color || null)
  const [accountId,   setAccountId]   = useState(initial?.account_id || '')
  const [status,      setStatus]      = useState(initial?.status || 'active')
  const [pauseUntil,  setPauseUntil]  = useState(initial?.pause_until || '')
  const [startedOn,   setStartedOn]   = useState(initial?.started_on || new Date().toISOString().slice(0,10))

  const initialCharges = initial?.charges?.filter(c => !c.effective_to) || []
  const [activeTab, setActiveTab] = useState(initialCharges.length > 1 ? 'split' : 'details')

  const [charges, setCharges] = useState(() =>
    initialCharges.length > 0
      ? initialCharges.map(c => ({ ...c, amount: String(c.amount), _original: { ...c, amount: String(c.amount) } }))
      : [defaultCharge(initial?.started_on)]
  )

  const firstCharge = initialCharges[0]
  const [singleAmount,    setSingleAmount]    = useState(firstCharge ? String(firstCharge.amount) : '')
  const [singleFrequency, setSingleFrequency] = useState(firstCharge?.frequency || 'monthly')
  const [singleAnchor,    setSingleAnchor]    = useState(firstCharge?.anchor_date || '')

  const [intentQueue, setIntentQueue] = useState(null)
  const [intentIndex, setIntentIndex] = useState(0)
  const [resolvedIntents, setResolved] = useState([])
  const [pendingForm,  setPendingForm] = useState(null)

  const parentCats    = categories.filter(c => !c.is_bill)
  const parentCatName = parentCats.find(c => c.id === parentCatId)?.category || ''
  const handleParentChange = (n) => { const cat = parentCats.find(c => c.category === n); setParentCatId(cat?.id||null) }

  const handleStartedOnChange = (newDate) => {
    setStartedOn(newDate)
    setSingleAnchor(a => a === startedOn ? newDate : a)
    setCharges(cs => cs.map(c => ({ ...c, anchor_date: c.anchor_date===startedOn?newDate:c.anchor_date, effective_from: c.effective_from===startedOn?newDate:c.effective_from })))
  }

  const handleAccountChange = (newId) => {
    setAccountId(newId)
    setCharges(cs => cs.map(c => (!c.account_id||c.account_id===accountId)?{...c,account_id:newId||null}:c))
  }

  const updateCharge = (i, val) => setCharges(cs => cs.map((c,idx) => {
    if (idx!==i) return c
    const updated = {...val}
    if (c._original) { const o=c._original; updated._dirty=(String(updated.amount)!==String(o.amount)||updated.frequency!==o.frequency||updated.anchor_date!==o.anchor_date||(updated.account_id||null)!==(o.account_id||null)||(updated.label||'')!==(o.label||'')) }
    return updated
  }))
  const removeCharge = (i) => setCharges(cs => cs.filter((_,idx)=>idx!==i))
  const addCharge    = ()  => setCharges(cs => [...cs, { ...defaultCharge(startedOn), account_id: accountId||null }])

  const handleTabChange = (tab) => {
    if (tab==='split' && activeTab==='details') {
      setCharges(cs => cs.length===1 ? [{ ...cs[0], label:cs[0].label||(name.trim()||'Charge'), amount:singleAmount||cs[0].amount, frequency:singleFrequency, anchor_date:singleAnchor||startedOn }] : cs)
    }
    if (tab==='details' && activeTab==='split' && charges.length>0) {
      setSingleAmount(charges[0].amount); setSingleFrequency(charges[0].frequency); setSingleAnchor(charges[0].anchor_date)
    }
    setActiveTab(tab)
  }

  const dirtyCount = charges.filter(c => c.id && c._dirty).length
  const allCharges = initial?.charges || []

  const detailsMonthly = (() => {
    const amt = parseFloat(singleAmount); if (!amt||isNaN(amt)) return null
    switch(singleFrequency) { case 'monthly': return amt; case 'quarterly': return amt/3; case 'semi_annual': return amt/6; case 'annual': return amt/12; default: return amt }
  })()

  const handleSubmit = (e) => {
    e.preventDefault()
    let finalCharges
    if (activeTab==='details') {
      const eid = initialCharges[0]?.id
      finalCharges = [{ ...(eid?{id:eid}:{}), label:name.trim()||'Payment', amount:parseFloat(singleAmount), frequency:singleFrequency, anchor_date:singleAnchor||startedOn, effective_from:initialCharges[0]?.effective_from||startedOn, account_id:accountId||null, _original:initialCharges[0]?{...initialCharges[0],amount:String(initialCharges[0].amount)}:undefined, _dirty:eid&&(String(parseFloat(singleAmount))!==String(initialCharges[0]?.amount)||singleFrequency!==initialCharges[0]?.frequency) }]
    } else {
      finalCharges = charges.map(c => ({ ...c, id:c.id||undefined, amount:parseFloat(c.amount), anchor_date:c.anchor_date||startedOn, effective_from:c.effective_from||startedOn }))
    }
    const formData = { name, description, parent_category_id:parentCatId||null, color:color||null, account_id:accountId||null, status, pause_until:status==='paused'?pauseUntil||null:null, started_on:startedOn, notes:description, charges:finalCharges }
    const dirty = finalCharges.filter(c => c.id && c._dirty)
    if (dirty.length>0) { setPendingForm(formData); setIntentQueue(dirty); setIntentIndex(0); setResolved([]) }
    else onSave(formData)
  }

  const handleIntentResolve = (resolution) => {
    if (!resolution) { setIntentQueue(null); return }
    const cur = intentQueue[intentIndex]
    const newResolved = [...resolvedIntents, { charge_id:cur.id, ...resolution }]
    setResolved(newResolved)
    const remaining = intentQueue.length-intentIndex-1
    if (resolution.applyToAll && remaining>0) {
      const rest = intentQueue.slice(intentIndex+1).map(r => ({ charge_id:r.id, intent:resolution.intent, effective_from:resolution.effective_from, target_month:resolution.target_month, applyToAll:false }))
      setIntentQueue(null); onSave({ ...pendingForm, _intents:[...newResolved,...rest] })
    } else if (intentIndex<intentQueue.length-1) { setIntentIndex(i=>i+1) }
    else { setIntentQueue(null); onSave({ ...pendingForm, _intents:newResolved }) }
  }

  return (
    <>
      <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&!intentQueue&&onClose()}>
        <div className="modal" style={{maxWidth:'820px',maxHeight:'90vh',display:'flex',flexDirection:'column'}}>

          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'4px',flexShrink:0}}>
            <h3 className="modal-title" style={{margin:0}}>{initial?'Edit bill':'Add bill'}</h3>
            <div className="budget-view-toggle">
              <button className={`budget-view-btn${activeTab==='details'?' active':''}`} type="button" onClick={()=>handleTabChange('details')}>Details</button>
              <button className={`budget-view-btn${activeTab==='split'?' active':''}`} type="button" onClick={()=>handleTabChange('split')} style={{display:'flex',alignItems:'center',gap:'4px'}}>
                <Scissors size={11}/>{charges.length>1?`Split (${charges.length})`:'Split'}
              </button>
            </div>
          </div>

          <div style={{overflowY:'auto',flex:1,scrollbarWidth:'none'}}>
            <form id="sub-form" onSubmit={handleSubmit} style={{display:'flex',flexDirection:'column',gap:0}}>

              <div className="modal-section-header">Category</div>
              <div className="modal-section">
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
                  <div className="form-group"><label>Name</label><input type="text" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Netflix" required /></div>
                  <div className="form-group"><label>Parent category</label><TreeSelect value={parentCatName} onChange={handleParentChange} categories={parentCats} placeholder="None (top-level)" selectableParents={true} allowClear={true} /></div>
                </div>
                <div className="form-group"><label>Color <span style={{color:'var(--text-tertiary)',fontWeight:400}}>(optional)</span></label><ColorPicker value={color} onChange={setColor} /></div>
              </div>

              <div className="modal-section-header">Bill</div>
              <div className="modal-section">
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'12px'}}>
                  <div className="form-group"><label>Status</label><select value={status} onChange={e=>setStatus(e.target.value)}><option value="active">Active</option><option value="paused">Paused</option><option value="cancelled">Cancelled</option></select></div>
                  <div className="form-group"><label>Started on</label><DateInput value={startedOn} onChange={handleStartedOnChange} required /></div>
                  <div className="form-group"><label>Account <span style={{color:'var(--text-tertiary)',fontWeight:400}}>(optional)</span></label><select value={accountId} onChange={e=>handleAccountChange(e.target.value)}><option value="">No account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
                </div>
                {status==='paused'&&(<div className="form-group" style={{maxWidth:'200px'}}><label>Pause until</label><DateInput value={pauseUntil} onChange={setPauseUntil} /></div>)}

                {activeTab==='details'&&(
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginTop:'4px'}}>
                    <div className="form-group"><label>Amount ($)</label><CurrencyInput value={singleAmount} onChange={setSingleAmount} placeholder="0.00" required /></div>
                    <div className="form-group"><label>Frequency</label><select value={singleFrequency} onChange={e=>setSingleFrequency(e.target.value)}>{FREQUENCIES.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}</select></div>
                    {detailsMonthly&&<div style={{gridColumn:'1/3',fontSize:'11px',color:'var(--text-tertiary)',marginTop:'-6px'}}>{singleFrequency!=='monthly'?`≈ ${formatCurrency(detailsMonthly)}/mo · `:''}{formatCurrency((detailsMonthly)*12)}/yr</div>}
                  </div>
                )}

                {activeTab==='split'&&(
                  <div style={{marginTop:'4px'}}>
                    <div style={{marginBottom:'6px'}}><label style={{fontSize:'12px',fontWeight:500}}>Charge rules</label><span style={{fontSize:'11px',color:'var(--text-tertiary)',marginLeft:'8px'}}>Each rule creates its own budget category</span></div>
                    <div style={{maxHeight:'280px',overflowY:'auto',scrollbarWidth:'none'}}>
                      <RecurringRulePanel columns={RULE_COLUMNS} headers={RULE_HEADERS} onAdd={addCharge} addLabel="Add rule" helperText="Split into labeled components (e.g. Principal, Interest, Escrow)." dirtyCount={dirtyCount}>
                        {charges.map((c,i)=>(<ChargeRuleRow key={i} charge={c} index={i} onChange={updateCharge} onRemove={removeCharge} canRemove={charges.length>1} started_on={startedOn} accounts={accounts} allCharges={allCharges} siblingCharges={charges} />))}
                      </RecurringRulePanel>
                    </div>
                  </div>
                )}

                <div className="form-group" style={{marginTop:'4px'}}><label>Description <span style={{color:'var(--text-tertiary)',fontWeight:400}}>(optional)</span></label><input type="text" value={description} onChange={e=>setDescription(e.target.value)} placeholder="Brief description or notes" /></div>
              </div>
            </form>
          </div>

          <div className="modal-btns" style={{flexShrink:0,paddingTop:'14px',borderTop:'1px solid var(--border)',marginTop:'4px'}}>
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" form="sub-form" className="btn-primary" disabled={loading}>{loading?'Saving...':'Save'}</button>
          </div>
        </div>
      </div>
      {intentQueue&&intentQueue[intentIndex]&&(
        <ChangeIntentModal row={intentQueue[intentIndex]} original={intentQueue[intentIndex]._original} rowIndex={intentIndex} totalDirty={intentQueue.length} onResolve={handleIntentResolve} />
      )}
    </>
  )
}

function DeleteConfirmModal({ title, message, onConfirm, onCancel }) {
  return (
    <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&onCancel()}>
      <div className="modal" style={{maxWidth:'400px'}}>
        <h3 className="modal-title">{title}</h3>
        <p style={{fontSize:'13px',color:'var(--text-secondary)',margin:'8px 0 20px'}}>{message}</p>
        <div className="modal-btns">
          <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn-danger" style={{background:'var(--red)',color:'#fff',border:'none'}} onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  )
}

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function fmtMonth(yyyymm) { const [y,m]=yyyymm.split('-').map(Number); return `${MONTHS_SHORT[m-1]} ${y}` }
function chargeMonthly(c) { switch(c.frequency){case 'monthly':return c.amount;case 'quarterly':return c.amount/3;case 'semi_annual':return c.amount/6;case 'annual':return c.amount/12;default:return c.amount} }
function chargeThisMonth(c,month) { return chargeOccursInMonth(c.anchor_date,c.frequency,month)?chargeMonthly(c):0 }
function chargeNextMonth(c,fromMonth) { for(let i=1;i<=24;i++){const d=new Date(fromMonth+'-01');d.setMonth(d.getMonth()+i);const m=d.toISOString().slice(0,7);if(chargeOccursInMonth(c.anchor_date,c.frequency,m))return m}return null }

function BillChargeRow({ charge, sub, color, month, onEditCharge, onDeleteCharge, isLast }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const monthly=chargeMonthly(charge), annual=monthly*12, thisAmt=chargeThisMonth(charge,month), isDue=thisAmt>0
  const dueBadge = isDue?<span className="sub-badge sub-badge--active" style={{fontSize:'10px'}}>Due {fmtMonth(month)}</span>:(()=>{const n=chargeNextMonth(charge,month);return n?<span className="sub-badge" style={{fontSize:'10px',background:'rgba(136,136,136,0.15)',color:'var(--text-tertiary)'}}>Next {fmtMonth(n)}</span>:null})()
  const status = sub.status!=='active'?sub.status:'active'
  return (
    <>
      <div className={`acct-tbl-row${status!=='active'?' acct-tbl-row--inactive':''}`} style={{paddingLeft:'3rem',background:'var(--bg-secondary)'}}>
        <div style={{display:'flex',alignItems:'center',gap:'10px',minWidth:0}}>
          <div className="budget-dot-btn" style={{background:color,flexShrink:0,opacity:0.6}} />
          <div style={{minWidth:0}}><span className="budget-cat-name">{charge.label||'(unlabeled)'}</span><div className="budget-cat-sub">{freqLabel(charge.frequency)}{charge.account_name?` · ${charge.account_name}`:''}</div></div>
        </div>
        <div>{dueBadge}</div>
        <div style={{textAlign:'right',fontSize:'13px',fontWeight:600,color:isDue?'var(--text)':'var(--text-tertiary)'}}>{isDue?formatCurrency(thisAmt):'—'}</div>
        <div style={{textAlign:'right',fontSize:'13px',color:'var(--text-secondary)'}}>{formatCurrency(monthly)}</div>
        <div style={{textAlign:'right',fontSize:'13px',color:'var(--text-secondary)'}}>{formatCurrency(annual)}</div>
        <RowMoreMenu items={[
          { label: 'Edit', onClick: () => onEditCharge(charge) },
          !isLast && { label: 'Remove', danger: true, onClick: () => setConfirmDelete(true) },
        ]} />
      </div>
      {confirmDelete&&<DeleteConfirmModal title="Remove charge rule" message={`Remove "${charge.label||'this charge'}"? This will zero out future budget months.`} onConfirm={()=>{setConfirmDelete(false);onDeleteCharge(charge)}} onCancel={()=>setConfirmDelete(false)} />}
    </>
  )
}

function BillChargeModal({ charge, sub, accounts, onClose, onSave, saving }) {
  const [label,setLabel]=useState(charge.label||''),[amount,setAmount]=useState(String(charge.amount)),[frequency,setFrequency]=useState(charge.frequency),[anchorDate,setAnchorDate]=useState(charge.anchor_date||sub.started_on),[accountId,setAccountId]=useState(charge.account_id||''),[intentModal,setIntentModal]=useState(false),[pendingForm,setPendingForm]=useState(null)
  const isDirty=label!==(charge.label||'')||amount!==String(charge.amount)||frequency!==charge.frequency||anchorDate!==(charge.anchor_date||sub.started_on)||(accountId||null)!==(charge.account_id||null)
  const handleSubmit=(e)=>{e.preventDefault();const uc={id:charge.id,label,amount:parseFloat(amount),frequency,anchor_date:anchorDate,effective_from:charge.effective_from,account_id:accountId||null};const oc=sub.charges.filter(c=>!c.effective_to&&c.id!==charge.id).map(c=>({id:c.id,label:c.label,amount:c.amount,frequency:c.frequency,anchor_date:c.anchor_date,effective_from:c.effective_from,account_id:c.account_id||null}));const fd={name:sub.name,description:sub.description||sub.notes||'',parent_category_id:sub.parent_category_id,color:sub.color,account_id:sub.account_id,status:sub.status,pause_until:sub.pause_until,started_on:sub.started_on,notes:sub.notes||'',charges:[...oc,uc]};if(isDirty){setPendingForm({formData:fd,updatedCharge:uc});setIntentModal(true)}else onClose()}
  const handleIntentResolve=(r)=>{if(!r){setIntentModal(false);return};onSave({...pendingForm.formData,scope:'this_and_future',_intents:[{charge_id:charge.id,...r}]})}
  return (
    <>{<div className="modal-bg" onClick={e=>e.target===e.currentTarget&&!intentModal&&onClose()}><div className="modal" style={{maxWidth:'480px'}}><h3 className="modal-title">Edit charge rule</h3><p style={{fontSize:'12px',color:'var(--text-tertiary)',marginTop:'-4px',marginBottom:'12px'}}>{sub.name}</p><form id="charge-form" onSubmit={handleSubmit} style={{display:'flex',flexDirection:'column',gap:'12px'}}><div className="form-group"><label>Label</label><input type="text" value={label} onChange={e=>setLabel(e.target.value)} required /></div><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}><div className="form-group"><label>Started on</label><DateInput value={anchorDate} onChange={setAnchorDate} required /></div><div className="form-group"><label>Frequency</label><select value={frequency} onChange={e=>setFrequency(e.target.value)}>{FREQUENCIES.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}</select></div></div><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}><div className="form-group"><label>Account</label><select value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">—</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div><div className="form-group"><label>Amount</label><CurrencyInput value={amount} onChange={setAmount} placeholder="0.00" required /></div></div><div className="modal-btns"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="submit" form="charge-form" className="btn-primary" disabled={saving}>{saving?'Saving...':'Save'}</button></div></form></div></div>}
    {intentModal&&<ChangeIntentModal row={{...charge,label,amount:parseFloat(amount),frequency,anchor_date:anchorDate,account_id:accountId||null}} original={charge} rowIndex={0} totalDirty={1} onResolve={handleIntentResolve} />}</>
  )
}

function BillTableRow({ sub, categories, accounts, month, onEdit, onDelete, onUpdate }) {
  // ── expanded=true by default ──
  const [expanded,setExpanded]=useState(true)
  const [editingCharge,setEditingCharge]=useState(null)
  const activeCharges=sub.charges.filter(c=>!c.effective_to),monthlyEq=monthlyEquivalent(sub.charges),thisMonthTotal=activeCharges.reduce((s,c)=>s+chargeThisMonth(c,month),0)
  const cat=categories.find(c=>c.bill_id===sub.id)||categories.find(c=>c.id===sub.parent_category_id)
  const color=sub.color||(cat?resolveColor(cat,categories):'var(--text-tertiary)'),hasCharges=activeCharges.length>1
  const resumingSoon=sub.status==='paused'&&sub.pause_until&&((new Date(sub.pause_until)-new Date())/86400000)>=0&&((new Date(sub.pause_until)-new Date())/86400000)<=30
  const statusBadgeEl=sub.status==='cancelled'?<span className="sub-badge sub-badge--cancelled">Cancelled</span>:sub.status==='paused'?<span className="sub-badge sub-badge--paused">Paused{sub.pause_until?` until ${new Date(sub.pause_until+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}`:''}</span>:<span className="sub-badge sub-badge--active">Active</span>
  const handleDeleteCharge=async(charge)=>{if(activeCharges.length<=1)return;const rem=activeCharges.filter(c=>c.id!==charge.id);await onUpdate({id:sub.id,data:{...{name:sub.name,description:sub.description||sub.notes||'',parent_category_id:sub.parent_category_id,color:sub.color,account_id:sub.account_id,status:sub.status,pause_until:sub.pause_until,started_on:sub.started_on,notes:sub.notes||'',charges:rem.map(c=>({id:c.id,label:c.label,amount:c.amount,frequency:c.frequency,anchor_date:c.anchor_date,effective_from:c.effective_from,account_id:c.account_id||null}))},scope:'this_and_future'}})}
  return (
    <>
      <div className={`acct-tbl-row${sub.status!=='active'?' acct-tbl-row--inactive':''}`}>
        <div style={{display:'flex',alignItems:'center',gap:'10px',minWidth:0}}>
          <button className={'budget-dot-btn'+(hasCharges?' budget-dot-btn--expandable':'')} style={{background:color,flexShrink:0}} onClick={e=>{e.stopPropagation();hasCharges&&setExpanded(v=>!v)}}>
            {hasCharges&&<svg className={'dot-chevron'+(expanded?' dot-chevron--open':'')} width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 3L4 5.5L6.5 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          </button>
          <div style={{minWidth:0}}><span className="budget-cat-name">{sub.name}</span>{(sub.account_name||sub.description)&&<div className="budget-cat-sub">{[sub.account_name,sub.description].filter(Boolean).join(' · ')}</div>}</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:'4px',flexWrap:'wrap'}}>{statusBadgeEl}{resumingSoon&&<span className="sub-badge sub-badge--resuming">Resumes {new Date(sub.pause_until+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>}</div>
        <div style={{textAlign:'right',fontSize:'13px',fontWeight:600,color:sub.status==='active'?'var(--text)':'var(--text-tertiary)'}}>{thisMonthTotal>0?formatCurrency(thisMonthTotal):'—'}</div>
        <div style={{textAlign:'right',fontSize:'13px',color:'var(--text-secondary)'}}>{formatCurrency(monthlyEq)}</div>
        <div style={{textAlign:'right',fontSize:'13px',color:'var(--text-secondary)'}}>{formatCurrency(monthlyEq*12)}</div>
        <RowMoreMenu items={[
          { label: 'Edit', onClick: () => onEdit(sub) },
          { label: 'Delete', danger: true, onClick: () => onDelete(sub.id) },
        ]} />
      </div>
      {expanded&&activeCharges.map(c=><BillChargeRow key={c.id} charge={c} sub={sub} color={color} month={month} onEditCharge={setEditingCharge} onDeleteCharge={handleDeleteCharge} isLast={activeCharges.length===1} />)}
      {editingCharge&&<BillChargeModal charge={editingCharge} sub={sub} accounts={accounts} onClose={()=>setEditingCharge(null)} onSave={async(form)=>{await onUpdate({id:sub.id,data:form});setEditingCharge(null)}} saving={false} />}
    </>
  )
}

function Bills() {
  document.title = 'Pinance | Bills'
  const [month,setMonth]=useState(currentMonth()),[showModal,setShowModal]=useState(false),[editing,setEditing]=useState(null),[statusFilter,setStatusFilter]=useState('active'),[openFilter,setOpenFilter]=useState(false)
  const filterRef=useRef(null)
  const {data:subs=[],isLoading}=useBills(),{data:categories=[]}=useBudget({}),{data:accounts=[]}=useAccounts()
  const createSub=useCreateBill(),updateSub=useUpdateBill(),deleteSub=useDeleteBill()
  useEffect(()=>{if(!openFilter)return;const h=(e)=>{if(filterRef.current&&!filterRef.current.contains(e.target))setOpenFilter(false)};document.addEventListener('mousedown',h);return()=>document.removeEventListener('mousedown',h)},[openFilter])
  const filtered=useMemo(()=>statusFilter==='all'?subs:subs.filter(s=>s.status===statusFilter),[subs,statusFilter])
  const activeSubs=subs.filter(s=>s.status==='active'),totalMonthly=activeSubs.reduce((s,sub)=>s+monthlyEquivalent(sub.charges),0)
  const dueThisMonth=activeSubs.filter(s=>s.charges.filter(c=>!c.effective_to).some(c=>c.frequency!=='monthly'&&chargeOccursInMonth(c.anchor_date,c.frequency,month)))
  const pausedCount=subs.filter(s=>s.status==='paused').length
  const filteredMonthly=filtered.reduce((s,sub)=>s+monthlyEquivalent(sub.charges),0)
  const filteredThisMonth=filtered.reduce((s,sub)=>s+(sub.charges||[]).filter(c=>!c.effective_to).reduce((a,c)=>a+chargeThisMonth(c,month),0),0)
  const [pendingEdit,setPendingEdit]=useState(null),[pendingForm,setPendingForm]=useState(null),[showScopeModal,setShowScopeModal]=useState(false)
  const handleSave=async(form)=>{
    if(editing){const budgetRelevant=(editing.parent_category_id??null)!==(form.parent_category_id??null)||editing.status!==form.status;if(budgetRelevant){setPendingEdit({id:editing.id,form});setPendingForm(form);setShowModal(false);setShowScopeModal(true);return}
      try{await updateSub.mutateAsync({id:editing.id,data:{...form,scope:'this_and_future'}});setShowModal(false);setEditing(null)}catch(err){console.error(err)}}
    else{try{await createSub.mutateAsync(form);setShowModal(false);setEditing(null)}catch(err){console.error(err)}}
  }
  const handleScopeConfirm=async(scope)=>{try{await updateSub.mutateAsync({id:pendingEdit.id,data:{...pendingEdit.form,scope}});setShowScopeModal(false);setPendingEdit(null);setPendingForm(null);setEditing(null)}catch(err){console.error(err)}}
  const handleDelete=async(id)=>{if(!window.confirm('Delete this bill?'))return;await deleteSub.mutateAsync(id)}
  const handleInlineUpdate=async({id,data})=>{try{await updateSub.mutateAsync({id,data:{...data,scope:'this_and_future'}})}catch(err){console.error(err)}}
  const STATUS_OPTIONS=[{value:'active',label:'Active'},{value:'paused',label:'Paused'},{value:'cancelled',label:'Cancelled'},{value:'all',label:'All'}]
  if(isLoading) return <div className="loading">Loading bills...</div>
  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Bills</h1><MonthPicker value={month} onChange={setMonth} /></div><button className="btn-primary" onClick={()=>{setEditing(null);setShowModal(true)}}>+ Add bill</button></div>
      <div className="grid-4" style={{marginBottom:'1.75rem'}}>
        <div className="card metric-card"><div className="metric-label">Monthly cost</div><div className="metric-value">{formatCurrency(totalMonthly)}</div><div className="metric-sub">across active bills</div></div>
        <div className="card metric-card"><div className="metric-label">Annual cost</div><div className="metric-value">{formatCurrency(totalMonthly*12)}</div><div className="metric-sub">estimated</div></div>
        <div className="card metric-card"><div className="metric-label">Non-standard this month</div><div className="metric-value" style={{color:dueThisMonth.length?'var(--amber)':undefined}}>{dueThisMonth.length}</div><div className="metric-sub">extra charges due</div></div>
        <div className="card metric-card"><div className="metric-label">Paused</div><div className="metric-value">{pausedCount}</div><div className="metric-sub">bills</div></div>
      </div>
      {subs.length===0?(<div className="card"><p className="muted" style={{fontSize:'13px'}}>No bills yet. <button className="btn-link" onClick={()=>setShowModal(true)}>Add one</button></p></div>):(
        <div className="card" style={{padding:0,'--dt-cols':REC_COLS}}>
          <div className="acct-tbl-header">
            <span className="col-header-label">Name</span>
            <div className="txn-filter-cell" ref={filterRef}>
              <button className="txn-col-header-btn" onClick={()=>setOpenFilter(o=>!o)}>
                <span className="col-header-label">Status{statusFilter!=='all'?` · ${statusFilter}`:''}</span>
                <svg className="txn-chevron" width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              {openFilter&&<div className="txn-filter-dropdown">{STATUS_OPTIONS.map(opt=><div key={opt.value} className="txn-filter-option" onClick={()=>{setStatusFilter(opt.value);setOpenFilter(false)}} style={{color:statusFilter===opt.value?'var(--accent)':undefined}}>{opt.label}</div>)}</div>}
            </div>
            <span className="col-header-label" style={{justifyContent:'flex-end'}}>This Month</span>
            <span className="col-header-label" style={{justifyContent:'flex-end'}}>Monthly</span>
            <span className="col-header-label" style={{justifyContent:'flex-end'}}>Annually</span>
            <div/>
          </div>
          {filtered.length===0?(<p className="muted" style={{fontSize:'13px',padding:'1.25rem 1.5rem'}}>No {statusFilter!=='all'?statusFilter:''} bills.</p>):(filtered.map(sub=><BillTableRow key={sub.id} sub={sub} categories={categories} accounts={accounts} month={month} onEdit={s=>{setEditing(s);setShowModal(true)}} onDelete={handleDelete} onUpdate={handleInlineUpdate} />))}
          {filtered.length>0&&(<div className="tbl-footer-row"><span className="footer-label">Total ({statusFilter==='all'?'all':statusFilter})</span><div/><span className="footer-value" style={{textAlign:'right'}}>{filteredThisMonth>0?formatCurrency(filteredThisMonth):'—'}</span><span className="footer-value" style={{textAlign:'right'}}>{formatCurrency(filteredMonthly)}</span><span className="footer-value" style={{textAlign:'right'}}>{formatCurrency(filteredMonthly*12)}</span><div/></div>)}
        </div>
      )}
      {showModal&&<BillModal initial={editing} categories={categories} accounts={accounts} onClose={()=>{setShowModal(false);setEditing(null)}} onSave={handleSave} loading={createSub.isPending||updateSub.isPending} />}
      {showScopeModal&&pendingEdit&&(
        <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&setShowScopeModal(false)}>
          <div className="modal" style={{maxWidth:'400px'}}>
            <h3 className="modal-title">Apply budget changes</h3>
            <p style={{fontSize:'13px',color:'var(--text-secondary)',marginBottom:'16px'}}>Which months should reflect this change?</p>
            <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
              <button className="btn-ghost" style={{textAlign:'left',padding:'12px 14px',display:'flex',flexDirection:'column',gap:'3px'}} onClick={()=>handleScopeConfirm('this_month')}><span style={{fontWeight:600,fontSize:'13px'}}>This month only</span><span style={{fontSize:'11px',color:'var(--text-tertiary)'}}>Only updates {new Date().toLocaleDateString('en-US',{month:'long',year:'numeric'})}</span></button>
              <button className="btn-ghost" style={{textAlign:'left',padding:'12px 14px',display:'flex',flexDirection:'column',gap:'3px'}} onClick={()=>handleScopeConfirm('this_and_future')}><span style={{fontWeight:600,fontSize:'13px'}}>This month and all future months</span><span style={{fontSize:'11px',color:'var(--text-tertiary)'}}>Updates all already-seeded months from today forward</span></button>
            </div>
            <div className="modal-btns" style={{marginTop:'16px'}}><button className="btn-ghost" onClick={()=>{if(pendingForm)setEditing(e=>({...e,...pendingForm}));setShowScopeModal(false);setShowModal(true)}}>Back</button></div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Bills