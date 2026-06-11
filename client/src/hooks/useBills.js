import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getBills, createBill, updateBill,
  deleteBill, recordPriceChange,
} from '../api'

export function useBills() {
  return useQuery({
    queryKey: ['bills'],
    queryFn:  () => getBills().then(r => r.data),
  })
}

export function useCreateBill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createBill,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['bills'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      qc.invalidateQueries({ queryKey: ['budget-template'] })
    },
  })
}

export function useUpdateBill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }) => updateBill(id, data),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['bills'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      qc.invalidateQueries({ queryKey: ['budget-template'] })
    },
  })
}

export function useDeleteBill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteBill,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['bills'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      qc.invalidateQueries({ queryKey: ['budget-template'] })
    },
  })
}

export function useRecordPriceChange() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }) => recordPriceChange(id, data),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['bills'] })
      qc.invalidateQueries({ queryKey: ['budget'] })
      qc.invalidateQueries({ queryKey: ['budget-template'] })
    },
  })
}