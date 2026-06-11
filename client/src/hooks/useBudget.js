import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getBudget, saveBudgetCategory, updateBudgetCategory, deleteBudgetCategory,
  getBudgetTemplate, saveBudgetTemplate, updateBudgetTemplate, deleteBudgetTemplate,
  syncTemplateFromCurrent, reorderBudget, reorderBudgetTemplate,
} from '../api'

// ── Monthly budget hooks ───────────────────────────────────────────────────────

export function useBudget(params = {}) {
  return useQuery({
    queryKey: ['budget', params],
    queryFn:  () => getBudget(params).then(res => res.data),
  })
}

export function useSaveBudgetCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: saveBudgetCategory,
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['budget'] }),
  })
}

export function useUpdateBudgetCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }) => updateBudgetCategory(id, data),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['budget'] })
      queryClient.invalidateQueries({ queryKey: ['budget'] })
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
    },
  })
}

export function useDeleteBudgetCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteBudgetCategory,
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['budget'] }),
  })
}

// ── Template hooks ────────────────────────────────────────────────────────────

export function useBudgetTemplate() {
  return useQuery({
    queryKey: ['budget-template'],
    queryFn:  () => getBudgetTemplate().then(res => res.data),
  })
}

export function useSaveBudgetTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: saveBudgetTemplate,
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['budget-template'] }),
  })
}

export function useUpdateBudgetTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }) => updateBudgetTemplate(id, data),
    onSuccess:  () => {
      queryClient.removeQueries({ queryKey: ['budget-template'] })
      queryClient.invalidateQueries({ queryKey: ['budget-template'] })
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
    },
  })
}

export function useDeleteBudgetTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteBudgetTemplate,
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['budget-template'] }),
  })
}

export function useSyncTemplateFromCurrent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: syncTemplateFromCurrent,
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['budget-template'] }),
  })
}

export function useReorderBudget() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: reorderBudget,
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['budget'] }),
  })
}

export function useReorderBudgetTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: reorderBudgetTemplate,
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['budget-template'] }),
  })
}