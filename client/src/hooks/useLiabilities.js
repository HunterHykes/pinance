import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getLiabilities, createLiability, updateLiability, deleteLiability } from '../api'

export function useLiabilities() {
  return useQuery({
    queryKey: ['liabilities'],
    queryFn:  () => getLiabilities().then(r => r.data),
  })
}

export function useCreateLiability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createLiability,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['liabilities'] })
      qc.invalidateQueries({ queryKey: ['networth'] })
    },
  })
}

export function useUpdateLiability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }) => updateLiability(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['liabilities'] })
      qc.invalidateQueries({ queryKey: ['networth'] })
    },
  })
}

export function useDeleteLiability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteLiability,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['liabilities'] })
      qc.invalidateQueries({ queryKey: ['networth'] })
    },
  })
}