import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

export const register  = (data) => api.post('/auth/register', data)
export const login     = (data) => api.post('/auth/login', data)
export const logout    = ()     => api.post('/auth/logout')
export const getMe          = ()     => api.get('/auth/me')
export const deleteUserAccount = (data) => api.delete('/auth/account', { data })
export const purgeUserData     = (data) => api.delete('/auth/data',    { data })

export const getSplits    = (txnId)         => api.get(`/splits/${txnId}`)
export const saveSplits   = (txnId, data)   => api.post(`/splits/${txnId}`, data)
export const deleteSplits = (txnId)         => api.delete(`/splits/${txnId}`)

export const getAccounts   = ()         => api.get('/accounts')
export const createAccount = (data)     => api.post('/accounts', data)
export const updateAccount = (id, data) => api.put(`/accounts/${id}`, data)
export const deleteAccount = (id, data) => api.delete(`/accounts/${id}`, data ? { data } : undefined)

export const getTransactions   = (params)   => api.get('/transactions', { params })
export const createTransaction = (data)     => api.post('/transactions', data)
export const updateTransaction = (id, data) => api.put(`/transactions/${id}`, data)
export const deleteTransaction = (id)       => api.delete(`/transactions/${id}`)

export const getBudget            = (params)   => api.get('/budget', { params })
export const saveBudgetCategory   = (data)     => api.post('/budget', data)
export const updateBudgetCategory = (id, data) => api.put(`/budget/${id}`, data)
export const deleteBudgetCategory = (id)       => api.delete(`/budget/${id}`)

export const getBudgetTemplate          = ()         => api.get('/budget/template')
export const saveBudgetTemplate         = (data)     => api.post('/budget/template', data)
export const updateBudgetTemplate       = (id, data) => api.put(`/budget/template/${id}`, data)
export const deleteBudgetTemplate       = (id)       => api.delete(`/budget/template/${id}`)
export const syncTemplateFromCurrent    = (data)     => api.post('/budget/template/sync-from-current', data)
export const loadDefaultTemplate        = ()         => api.post('/budget/template/load-defaults')
export const reorderBudget              = (data)     => api.put('/budget/reorder', data)
export const reorderBudgetTemplate      = (data)     => api.put('/budget/template/reorder', data)

export const getCategoryMap        = ()     => api.get('/category-map')
export const getPlaidCategories    = ()     => api.get('/category-map/plaid-categories')
export const saveCategoryMap       = (data) => api.post('/category-map', data)
export const applyCategoryMap      = (data) => api.post('/category-map/apply', data)
export const deleteCategoryMap     = (id)   => api.delete(`/category-map/${id}`)

export const getLinkToken  = ()     => api.post('/plaid/link/token')
export const exchangeToken = (data) => api.post('/plaid/exchange', data)
export const syncPlaid     = ()     => api.post('/plaid/sync')
export const getPlaidItems = ()     => api.get('/plaid/items')
export const disconnectPlaidItem   = (id, data) => api.delete(`/plaid/items/${id}`, data ? { data } : undefined)
export const getPlaidSettings      = ()           => api.get('/plaid/settings')
export const savePlaidSettings     = (data)       => api.put('/plaid/settings', data)
export const getPlaidCostEstimate  = (frequency)  => api.get('/plaid/settings/estimate', { params: { frequency } })
export const getPlaidUsage         = (month)      => api.get('/plaid/usage', { params: { month } })

export const getNetWorth      = (params) => api.get('/networth', { params })

export const getAssets    = ()         => api.get('/assets')
export const createAsset  = (data)     => api.post('/assets', data)
export const updateAsset  = (id, data) => api.put(`/assets/${id}`, data)
export const deleteAsset  = (id)       => api.delete(`/assets/${id}`)

export const getLiabilities       = ()         => api.get('/liabilities')
export const createLiability      = (data)     => api.post('/liabilities', data)
export const updateLiability      = (id, data) => api.put(`/liabilities/${id}`, data)
export const deleteLiability      = (id)       => api.delete(`/liabilities/${id}`)
export const getLiabilitySchedule = (id)       => api.get(`/liabilities/${id}/schedule`)

export const getProjectorInputs   = ()           => api.get('/projector/inputs')
export const saveProjectorInput   = (type, id, data) => api.put(`/projector/inputs/${type}/${id}`, data)
export const getProjection        = (params)     => api.get('/projector', { params })
export const getProjectorBounds   = ()           => api.get('/projector/bounds')

export const getAccountPrefs  = ()           => api.get('/account-prefs')

export const getBills     = ()         => api.get('/bills')
export const createBill   = (data)     => api.post('/bills', data)
export const updateBill   = (id, data) => api.put(`/bills/${id}`, data)
export const deleteBill   = (id)       => api.delete(`/bills/${id}`)
export const recordPriceChange    = (id, data) => api.post(`/bills/${id}/price-change`, data)

export const getIncomeSources     = ()         => api.get('/income')
export const createIncomeSource   = (data)     => api.post('/income', data)
export const updateIncomeSource   = (id, data) => api.put(`/income/${id}`, data)
export const deleteIncomeSource   = (id)       => api.delete(`/income/${id}`)
export const recordAmountChange   = (id, data) => api.post(`/income/${id}/amount-change`, data)
export const saveAccountPref  = (id, data)   => api.put(`/account-prefs/${id}`, data)

export default api