import { useState, useMemo, useRef, useEffect } from 'react'
import { TrendingUp, Scissors } from 'lucide-react'
import RowMoreMenu from '../components/RowMoreMenu'
import {
  useIncomeSources, useCreateIncomeSource, useUpdateIncomeSource,
  useDeleteIncomeSource,
} from '../hooks/useIncome'
import { useBudget } from '../hooks/useBudget'
import { useAccounts } from '../hooks/useAccounts'
import { formatCurrency, currentMonth, resolveColor } from '../utils'
import TreeSelect from '../components/TreeSelect'
import ColorPicker from '../components/ColorPicker'
import ChangeIntentModal from '../components/ChangeIntentModal'
import RecurringRulePanel from '../components/RecurringRulePanel'
import { MonthPicker } from '../components/DateRangePicker'
import { CurrencyInput, DateInput } from '../components/FormControls'
import IncomeModal from '../components/IncomeModal'
import FrequencyPicker, { defaultSchedule as makeDefaultSchedule } from '../components/FrequencyPicker'
import { occursInMonth, occurrencesPerMonth as scheduleOccurrences } from '../scheduleUtils'

const FREQUENCIES = [
  { value: 'weekly',        label: 'Weekly' },
  { value: 'biweekly',      label: 'Every two weeks' },
  { value: 'twice_monthly', label: 'Twice a month' },
  { value: 'monthly',       label: 'Monthly' },
  { value: 'quarterly',     label: 'Quarterly' },
  { value: 'semi_annual',   label: 'Semi-annual' },
  { value: 'annual',        label: 'Annual' },
  { value: 'custom_days',   label: 'Custom days' },
]
const REC_COLS    = 'minmax(0,1fr) minmax(100px,140px) minmax(80px,100px) minmax(80px,100px) minmax(80px,100px) 36px'
const RULE_COLUMNS = '2fr 130px 140px 130px 24px 110px 48px'
const RULE_HEADERS = ['Label', 'Started on', 'Frequency', 'Account', '', 'Amount', '']

function freqLabel(f) { return FREQUENCIES.find(x=>x.value===f)?.label||f }

function occurrencesPerMonth(frequency, customDays) {
  switch(frequency){case 'monthly':return 1;case 'twice_monthly':return 2;case 'weekly':return 4.33;case 'biweekly':return 2.17;case 'quarterly':return 1/3;case 'semi_annual':return 1/6;case 'annual':return 1/12;case 'custom_days':return customDays?customDays.split(',').filter(d=>d.trim()).length:1;default:return 1}
}

function monthlyEquivalent(schedules) {
  return schedules.filter(s=>!s.effective_to).reduce((sum,s)=>sum+s.amount*occurrencesPerMonth(s.frequency,s.custom_days),0)
}

function incomeOccursInMonth(anchorDate, frequency, customDays, targetMonth) {
  if(!anchorDate) return false
  const anchor=new Date(anchorDate+'T00:00:00');const [ty,tm]=targetMonth.split('-').map(Number)
  switch(frequency){case 'monthly':case 'twice_monthly':case 'weekly':return true;case 'biweekly':{const start=new Date(`${targetMonth}-01T00:00:00`),end=new Date(ty,tm,0);let d=new Date(anchor);while(d>start)d.setDate(d.getDate()-14);while(d<start)d.setDate(d.getDate()+14);return d<=end}case 'quarterly':{const am=anchor.getFullYear()*12+anchor.getMonth(),bm=ty*12+(tm-1);return bm>=am&&(bm-am)%3===0}case 'semi_annual':{const am=anchor.getFullYear()*12+anchor.getMonth(),bm=ty*12+(tm-1);return bm>=am&&(bm-am)%6===0}case 'annual':return anchor.getMonth()===(tm-1)&&ty>=anchor.getFullYear();case 'custom_days':return !!(customDays&&customDays.trim().length>0);default:return false}
}

function deriveAnchorDate(frequency, startedOn) { return startedOn||new Date().toISOString().slice(0,10) }
const defaultSchedule=(startedOn)=>({label:'',amount:'',frequency:'biweekly',custom_days:'',anchor_date:deriveAnchorDate('biweekly',startedOn),effective_from:startedOn||new Date().toISOString().slice(0,10)})


function ScheduleRuleRow({ schedule, index, onChange, onRemove, canRemove, started_on, accounts, allSchedules, siblingSchedules }) {
  const [showHist,setShowHist]=useState(false)
  const isExisting=!!schedule.id,isDirty=isExisting&&schedule._dirty
  const set=(field,val)=>onChange(index,{...schedule,[field]:val})
  const labelTrimmed=schedule.label?.trim()||''
  const isDupLabel=labelTrimmed!==''&&(siblingSchedules||[]).some((s,i)=>i!==index&&(s.label?.trim()||'')===labelTrimmed)
  const handleFreqChange=(freq)=>{const a=deriveAnchorDate(freq,started_on);onChange(index,{...schedule,frequency:freq,anchor_date:a})}
  const itemHist=useMemo(()=>(!schedule.budget_category_id||!allSchedules)?[]:allSchedules.filter(s=>s.budget_category_id===schedule.budget_category_id),[schedule.budget_category_id,allSchedules])
  return (
    <>
      <div style={{display:'grid',gridTemplateColumns:RULE_COLUMNS,gap:'6px',alignItems:'center',padding:'6px 0',borderBottom:'1px solid var(--border)',background:isDirty?'rgba(59,130,246,0.04)':'transparent'}}>
        <div style={{position:'relative'}}>
          <input type="text" value={schedule.label} onChange={e=>set('label',e.target.value)} placeholder="Label" required style={{fontSize:'13px',borderColor:isDupLabel?'var(--red)':undefined,outline:isDupLabel?'1px solid var(--red)':undefined,width:'100%'}} />
          {isDupLabel&&<span style={{position:'absolute',top:'100%',left:0,fontSize:'10px',color:'var(--red)',whiteSpace:'nowrap',marginTop:'1px'}}>Duplicate label</span>}
        </div>
        <DateInput value={schedule.anchor_date||started_on||''} onChange={v=>set('anchor_date',v)} />
        <FrequencyPicker value={schedule.schedule||makeDefaultSchedule(schedule.frequency||'biweekly')} onChange={s=>onChange(index,{...schedule,schedule:s,frequency:s.type})} mode="income" />
        <select value={schedule.account_id||''} onChange={e=>set('account_id',e.target.value||null)} style={{fontSize:'13px'}}><option value="">—</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <div style={{display:'flex',justifyContent:'center'}}>{isExisting&&itemHist.length>1&&<button type="button" className={`btn-trend${showHist?' btn-trend--active':''}`} onClick={()=>setShowHist(h=>!h)} title="History"><TrendingUp size={12}/></button>}</div>
        <CurrencyInput value={schedule.amount} onChange={v=>set('amount',v)} placeholder="0.00" required inputStyle={{fontSize:'13px'}} />
        <div style={{display:'flex',justifyContent:'center'}}>{canRemove&&<button type="button" className="btn-icon-remove" onClick={()=>onRemove(index)} title="Remove"><span style={{fontSize:'16px',lineHeight:1}}>−</span></button>}</div>
      </div>
      {showHist&&itemHist.length>0&&(<div style={{padding:'4px 0 8px',borderBottom:'1px solid var(--border)'}}>{[...itemHist].sort((a,b)=>b.effective_from.localeCompare(a.effective_from)).map(s=><div key={s.id} className="sub-history-row"><span style={{color:s.effective_to?'var(--text-tertiary)':'var(--text)'}}>{s.label} — {formatCurrency(s.amount)} / {freqLabel(s.frequency)}</span><span style={{fontSize:'11px',color:'var(--text-tertiary)'}}>{new Date(s.effective_from+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}{s.effective_to?` → ${new Date(s.effective_to+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`:' → present'}</span></div>)}</div>)}
    </>
  )
}

function DeleteConfirmModal({ title, message, onConfirm, onCancel }) {
  return (
    <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&onCancel()}>
      <div className="modal" style={{maxWidth:'400px'}}>
        <h3 className="modal-title">{title}</h3>
        <p style={{fontSize:'13px',color:'var(--text-secondary)',margin:'8px 0 20px'}}>{message}</p>
        <div className="modal-btns"><button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button><button type="button" className="btn-danger" style={{background:'var(--red)',color:'#fff',border:'none'}} onClick={onConfirm}>Delete</button></div>
      </div>
    </div>
  )
}

const MONTHS_SHORT=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function fmtMonth(yyyymm){const [y,m]=yyyymm.split('-').map(Number);return `${MONTHS_SHORT[m-1]} ${y}`}
function scheduleThisMonth(s,month){if(!incomeOccursInMonth(s.anchor_date,s.frequency,s.custom_days,month))return 0;return s.amount*occurrencesPerMonth(s.frequency,s.custom_days)}
function scheduleNextMonth(s,fromMonth){for(let i=1;i<=24;i++){const d=new Date(fromMonth+'-01');d.setMonth(d.getMonth()+i);const m=d.toISOString().slice(0,7);if(incomeOccursInMonth(s.anchor_date,s.frequency,s.custom_days,m))return m}return null}

function IncomeScheduleRow({ schedule, src, color, month, onEditSchedule, onDeleteSchedule, isLast }) {
  const [confirmDelete,setConfirmDelete]=useState(false)
  const occ=occurrencesPerMonth(schedule.frequency,schedule.custom_days),monthly=schedule.amount*occ,annual=monthly*12,thisAmt=scheduleThisMonth(schedule,month),isDue=thisAmt>0
  const dueBadge=isDue?<span className="sub-badge sub-badge--active" style={{fontSize:'10px'}}>Due {fmtMonth(month)}</span>:(()=>{const n=scheduleNextMonth(schedule,month);return n?<span className="sub-badge" style={{fontSize:'10px',background:'rgba(136,136,136,0.15)',color:'var(--text-tertiary)'}}>Next {fmtMonth(n)}</span>:null})()
  return (
    <>
      <div className="acct-tbl-row" style={{paddingLeft:'3rem',background:'var(--bg-secondary)'}}>
        <div style={{display:'flex',alignItems:'center',gap:'10px',minWidth:0}}>
          <div className="budget-dot-btn" style={{background:color,flexShrink:0,opacity:0.6}} />
          <div style={{minWidth:0}}><span className="budget-cat-name">{schedule.label||'(unlabeled)'}</span><div className="budget-cat-sub">{freqLabel(schedule.frequency)}{schedule.account_name?` · ${schedule.account_name}`:''}</div></div>
        </div>
        <div>{dueBadge}</div>
        <div style={{textAlign:'right',fontSize:'13px',fontWeight:600,color:isDue?'var(--green)':'var(--text-tertiary)'}}>{isDue?formatCurrency(thisAmt):'—'}</div>
        <div style={{textAlign:'right',fontSize:'13px',color:'var(--text-secondary)'}}>{formatCurrency(monthly)}</div>
        <div style={{textAlign:'right',fontSize:'13px',color:'var(--text-secondary)'}}>{formatCurrency(annual)}</div>
        <RowMoreMenu items={[
          { label: 'Edit', onClick: () => onEditSchedule(schedule) },
          !isLast && { label: 'Remove', danger: true, onClick: () => setConfirmDelete(true) },
        ]} />
      </div>
      {confirmDelete&&<DeleteConfirmModal title="Remove pay schedule" message={`Remove "${schedule.label||'this schedule'}"? This will zero out future budget months.`} onConfirm={()=>{setConfirmDelete(false);onDeleteSchedule(schedule)}} onCancel={()=>setConfirmDelete(false)} />}
    </>
  )
}

function IncomeScheduleModal({ schedule, src, accounts, onClose, onSave, saving }) {
  const [label,      setLabel]      = useState(schedule.label || '')
  const [amount,     setAmount]     = useState(String(schedule.amount))
  const [frequency,  setFrequency]  = useState(schedule.frequency)
  const [scheduleVal,setScheduleVal]= useState(schedule.schedule ? (typeof schedule.schedule === 'string' ? JSON.parse(schedule.schedule) : schedule.schedule) : makeDefaultSchedule(schedule.frequency || 'biweekly'))
  const [anchorDate, setAnchorDate] = useState(schedule.anchor_date || src.started_on)
  const [accountId,  setAccountId]  = useState(schedule.account_id || '')
  const [intentModal,  setIntentModal]  = useState(false)
  const [pendingForm,  setPendingForm]  = useState(null)

  const isDirty = label !== (schedule.label || '') || amount !== String(schedule.amount) ||
    frequency !== schedule.frequency || anchorDate !== (schedule.anchor_date || src.started_on) ||
    (accountId || null) !== (schedule.account_id || null)

  const handleSubmit = (e) => {
    e.preventDefault()
    const us = { id: schedule.id, label, amount: parseFloat(amount), frequency, schedule: scheduleVal, anchor_date: anchorDate, effective_from: schedule.effective_from, account_id: accountId || null }
    const os = src.schedules.filter(s => !s.effective_to && s.id !== schedule.id).map(s => ({ id: s.id, label: s.label, amount: s.amount, frequency: s.frequency, schedule: s.schedule, anchor_date: s.anchor_date, effective_from: s.effective_from, account_id: s.account_id || null }))
    const fd = { name: src.name, description: src.description || src.notes || '', parent_category_id: src.parent_category_id, color: src.color, account_id: src.account_id, status: src.status, started_on: src.started_on, notes: src.notes || '', schedules: [...os, us] }
    if (isDirty) { setPendingForm({ formData: fd, updatedSchedule: us }); setIntentModal(true) } else onClose()
  }
  const handleIntentResolve = (r) => {
    if (!r) { setIntentModal(false); return }
    onSave({ ...pendingForm.formData, _intents: [{ schedule_id: schedule.id, ...r }] })
  }

  const colStyle = { fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-tertiary)' }
  const COLS = 'minmax(120px,130px) minmax(130px,1fr) minmax(130px,1.5fr) minmax(130px,155px) minmax(180px,1fr)' 

  return (
    <>
      <div className="modal-bg" onClick={e => e.target === e.currentTarget && !intentModal && onClose()}>
        <div className="modal" style={{ maxWidth: '960px' }}>
          <h3 className="modal-title" style={{ marginBottom: '2px' }}>Edit Pay Schedule</h3>
          <p style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '12px' }}>{src.name}</p>
          <form id="sched-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="card" style={{ padding: 0, '--dt-cols': COLS }}>
              <div className="acct-tbl-header" style={{ position: 'relative', top: 'unset', padding: '6px 0.75rem' }}>
                {['Amount', 'Account', 'Label', 'Started On', 'Frequency'].map((h, i) => (
                  <div key={i} style={colStyle}>{h}</div>
                ))}
              </div>
              <div className="acct-tbl-row" style={{ padding: '5px 0.75rem', alignItems: 'center' }}>
                <CurrencyInput value={amount} onChange={setAmount} placeholder="0.00" required />
                <select value={accountId} onChange={e => setAccountId(e.target.value)} style={{ fontSize: '13px' }}>
                  <option value="">—</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="Label" required style={{ fontSize: '13px' }} />
                <DateInput value={anchorDate} onChange={setAnchorDate} />
                <FrequencyPicker
                  value={scheduleVal}
                  onChange={s => { setScheduleVal(s); setFrequency(s.type) }}
                  mode="income"
                />
              </div>
            </div>
            <div className="modal-btns">
              <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" form="sched-form" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </form>
        </div>
      </div>
      {intentModal && <ChangeIntentModal row={{ ...schedule, label, amount: parseFloat(amount), frequency, anchor_date: anchorDate, account_id: accountId || null, _original: schedule }} original={schedule} rowIndex={0} totalDirty={1} onResolve={handleIntentResolve} />}
    </>
  )
}

function IncomeTableRow({ src, categories, accounts, month, onEdit, onDelete, onUpdate }) {
  const [expanded,setExpanded]=useState(true),[editingSchedule,setEditingSchedule]=useState(null)
  const activeSchedules=src.schedules.filter(s=>!s.effective_to),monthlyEq=monthlyEquivalent(src.schedules),thisMonthTotal=activeSchedules.reduce((s,sc)=>s+scheduleThisMonth(sc,month),0)
  const cat=categories.find(c=>c.income_id===src.id)||categories.find(c=>c.id===src.parent_category_id)
  const color=src.color||(cat?resolveColor(cat,categories):'var(--text-tertiary)'),hasSchedules=activeSchedules.length>1
  const statusBadgeEl=src.status==='stopped'?<span className="sub-badge sub-badge--cancelled">Stopped</span>:src.status==='paused'?<span className="sub-badge sub-badge--paused">Paused</span>:<span className="sub-badge sub-badge--active">Active</span>
  const handleDeleteSchedule=async(schedule)=>{if(activeSchedules.length<=1)return;const rem=activeSchedules.filter(s=>s.id!==schedule.id);await onUpdate({id:src.id,data:{name:src.name,description:src.description||src.notes||'',parent_category_id:src.parent_category_id,color:src.color,account_id:src.account_id,status:src.status,started_on:src.started_on,notes:src.notes||'',schedules:rem.map(s=>({id:s.id,label:s.label,amount:s.amount,frequency:s.frequency,anchor_date:s.anchor_date,effective_from:s.effective_from,account_id:s.account_id||null,custom_days:s.custom_days||null}))}})}
  return (
    <>
      <div className={`acct-tbl-row${src.status!=='active'?' acct-tbl-row--inactive':''}`}>
        <div style={{display:'flex',alignItems:'center',gap:'10px',minWidth:0}}>
          <button className={'budget-dot-btn'+(hasSchedules?' budget-dot-btn--expandable':'')} style={{background:color,flexShrink:0}} onClick={e=>{e.stopPropagation();hasSchedules&&setExpanded(v=>!v)}}>
            {hasSchedules&&<svg className={'dot-chevron'+(expanded?' dot-chevron--open':'')} width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 3L4 5.5L6.5 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          </button>
          <div style={{minWidth:0}}><span className="budget-cat-name">{src.name}</span>{(src.parent_category_name||src.description)&&<div className="budget-cat-sub">{[src.parent_category_name||'Income',src.description].filter(Boolean).join(' · ')}{(()=>{const a=[...new Set(activeSchedules.map(s=>s.account_name).filter(Boolean))];return a.length?` · ${a.join(', ')}`:null})()}</div>}</div>
        </div>
        <div>{statusBadgeEl}</div>
        <div style={{textAlign:'right',fontSize:'13px',fontWeight:600,color:src.status==='active'?'var(--green)':'var(--text-tertiary)'}}>{formatCurrency(thisMonthTotal)}</div>
        <div style={{textAlign:'right',fontSize:'13px',color:'var(--text-secondary)'}}>{formatCurrency(monthlyEq)}</div>
        <div style={{textAlign:'right',fontSize:'13px',color:'var(--text-secondary)'}}>{formatCurrency(monthlyEq*12)}</div>
        <RowMoreMenu items={[
          { label: 'Edit', onClick: () => onEdit(src) },
          { label: 'Delete', danger: true, onClick: () => onDelete(src.id) },
        ]} />
      </div>
      {hasSchedules&&expanded&&activeSchedules.map(s=><IncomeScheduleRow key={s.id} schedule={s} src={src} color={color} month={month} onEditSchedule={setEditingSchedule} onDeleteSchedule={handleDeleteSchedule} isLast={activeSchedules.length===1} />)}
      {editingSchedule&&<IncomeScheduleModal schedule={editingSchedule} src={src} accounts={accounts} onClose={()=>setEditingSchedule(null)} onSave={async(form)=>{await onUpdate({id:src.id,data:form});setEditingSchedule(null)}} saving={false} />}
    </>
  )
}

function Income() {
  document.title = 'Pinance | Income'
  const [showModal,setShowModal]=useState(false),[editing,setEditing]=useState(null),[month,setMonth]=useState(currentMonth()),[statusFilter,setStatusFilter]=useState('active'),[openFilter,setOpenFilter]=useState(false)
  const filterRef=useRef(null)
  const {data:sources=[],isLoading}=useIncomeSources(),{data:categories=[]}=useBudget({}),{data:accounts=[]}=useAccounts()
  const createSource=useCreateIncomeSource(),updateSource=useUpdateIncomeSource(),deleteSource=useDeleteIncomeSource()
  useEffect(()=>{if(!openFilter)return;const h=(e)=>{if(filterRef.current&&!filterRef.current.contains(e.target))setOpenFilter(false)};document.addEventListener('mousedown',h);return()=>document.removeEventListener('mousedown',h)},[openFilter])
  const filtered=useMemo(()=>statusFilter==='all'?sources:sources.filter(s=>s.status===statusFilter),[sources,statusFilter])
  const activeSources=sources.filter(s=>s.status==='active'),totalMonthly=activeSources.reduce((s,src)=>s+monthlyEquivalent(src.schedules),0)
  const filteredMonthly=filtered.reduce((s,src)=>s+monthlyEquivalent(src.schedules),0)
  const filteredThisMonth=filtered.reduce((s,src)=>s+src.schedules.filter(sc=>!sc.effective_to).reduce((a,sc)=>a+scheduleThisMonth(sc,month),0),0)
  const handleSave=async(form)=>{try{if(editing)await updateSource.mutateAsync({id:editing.id,data:form});else await createSource.mutateAsync(form);setShowModal(false);setEditing(null)}catch(err){console.error(err)}}
  const handleDelete=async(id)=>{if(!window.confirm('Delete this income source? Future budget months will be zeroed out.'))return;await deleteSource.mutateAsync(id)}
  const handleInlineUpdate=async({id,data})=>{try{await updateSource.mutateAsync({id,data})}catch(err){console.error(err)}}
  const STATUS_OPTIONS=[{value:'active',label:'Active'},{value:'paused',label:'Paused'},{value:'stopped',label:'Stopped'},{value:'all',label:'All'}]
  if(isLoading) return <div className="loading">Loading income...</div>
  return (
    <div>
      <div className="page-header"><div><h1 className="page-title">Income</h1><MonthPicker value={month} onChange={setMonth} /></div><button className="btn-primary" onClick={()=>{setEditing(null);setShowModal(true)}}>+ Add Income</button></div>
      <div className="grid-4" style={{marginBottom:'1.75rem'}}>
        <div className="card metric-card"><div className="metric-label">Expected monthly</div><div className="metric-value up">{formatCurrency(totalMonthly)}</div><div className="metric-sub">net take-home</div></div>
        <div className="card metric-card"><div className="metric-label">Expected annual</div><div className="metric-value up">{formatCurrency(totalMonthly*12)}</div><div className="metric-sub">estimated</div></div>
        <div className="card metric-card"><div className="metric-label">Active sources</div><div className="metric-value">{activeSources.length}</div></div>
        <div className="card metric-card"><div className="metric-label">Stopped</div><div className="metric-value">{sources.filter(s=>s.status==='stopped').length}</div></div>
      </div>
      {sources.length===0?(<div className="card"><p className="muted" style={{fontSize:'13px'}}>No income sources yet. <button className="btn-link" onClick={()=>setShowModal(true)}>Add one</button></p></div>):(
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
          {filtered.length===0?(<p className="muted" style={{fontSize:'13px',padding:'1.25rem 1.5rem'}}>No {statusFilter!=='all'?statusFilter:''} income sources.</p>):(filtered.map(src=><IncomeTableRow key={src.id} src={src} categories={categories} accounts={accounts} month={month} onEdit={s=>{setEditing(s);setShowModal(true)}} onDelete={handleDelete} onUpdate={handleInlineUpdate} />))}
          {filtered.length>0&&(<div className="tbl-footer-row"><span className="footer-label">Total ({statusFilter==='all'?'all':statusFilter})</span><div/><span className="footer-value footer-value--up" style={{textAlign:'right'}}>{formatCurrency(filteredThisMonth)}</span><span className="footer-value" style={{textAlign:'right'}}>{formatCurrency(filteredMonthly)}</span><span className="footer-value" style={{textAlign:'right'}}>{formatCurrency(filteredMonthly*12)}</span><div/></div>)}
        </div>
      )}
      {showModal&&<IncomeModal initial={editing} categories={categories} accounts={accounts} onClose={()=>{setShowModal(false);setEditing(null)}} onSave={handleSave} loading={createSource.isPending||updateSource.isPending} />}
    </div>
  )
}

export default Income