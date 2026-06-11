import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getIncomeSources, createIncomeSource, updateIncomeSource,
  deleteIncomeSource, recordAmountChange,
} from '../api'

export function useIncomeSources() {
  return useQuery({
    queryKey: ['income'],
    queryFn:  () => getIncomeSources().then(r => r.data),
  })
}

export function useCreateIncomeSource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createIncomeSource,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['income'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      qc.invalidateQueries({ queryKey: ['budget-template'] })
    },
  })
}

export function useUpdateIncomeSource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }) => updateIncomeSource(id, data),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['income'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      qc.invalidateQueries({ queryKey: ['budget-template'] })
    },
  })
}

export function useDeleteIncomeSource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteIncomeSource,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['income'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      qc.invalidateQueries({ queryKey: ['budget-template'] })
    },
  })
}

export function useRecordAmountChange() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }) => recordAmountChange(id, data),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['income'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      qc.invalidateQueries({ queryKey: ['budget-template'] })
    },
  })
}