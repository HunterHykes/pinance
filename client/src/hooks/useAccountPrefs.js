import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAccountPrefs, saveAccountPref } from '../api'
import api from '../api'

// ── Account prefs (display name, line style, hidden) ─────────────────────────

export function useAccountPrefs() {
  return useQuery({
    queryKey: ['account-prefs'],
    queryFn:  () => getAccountPrefs().then(res => res.data),
  })
}

export function useSaveAccountPref() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }) => saveAccountPref(id, data),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['account-prefs'] })
      qc.invalidateQueries({ queryKey: ['networth'] })
    },
  })
}

// ── Institution prefs (color, url, sync_frequency) ───────────────────────────

export function useInstitutionPrefs() {
  return useQuery({
    queryKey: ['institution-prefs'],
    queryFn:  () => api.get('/account-prefs/institution').then(r => r.data),
  })
}

export function useSaveInstitutionPref() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ institution, data }) =>
      api.put(`/account-prefs/institution/${encodeURIComponent(institution)}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['institution-prefs'] })
      qc.invalidateQueries({ queryKey: ['networth'] })
    },
  })
}

// ── Balance snapshots ─────────────────────────────────────────────────────────

export function useAccountSnapshots(accountId) {
  return useQuery({
    queryKey: ['account-snapshots', accountId],
    queryFn:  () => api.get(`/account-prefs/${accountId}/snapshots`).then(r => r.data),
    enabled:  !!accountId,
  })
}

export function useSaveAccountSnapshot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ accountId, date, balance }) =>
      api.put(`/account-prefs/${accountId}/snapshots`, { date, balance }),
    onSuccess: (_, { accountId }) => {
      qc.invalidateQueries({ queryKey: ['account-snapshots', accountId] })
      qc.invalidateQueries({ queryKey: ['networth'] })
    },
  })
}

export function useDeleteAccountSnapshot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ accountId, date }) =>
      api.delete(`/account-prefs/${accountId}/snapshots/${date}`),
    onSuccess: (_, { accountId }) => {
      qc.invalidateQueries({ queryKey: ['account-snapshots', accountId] })
      qc.invalidateQueries({ queryKey: ['networth'] })
    },
  })
}