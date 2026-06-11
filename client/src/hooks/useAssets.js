import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAssets, createAsset, updateAsset, deleteAsset } from '../api'

export function useAssets() {
  return useQuery({
    queryKey: ['assets'],
    queryFn:  () => getAssets().then(res => res.data),
  })
}

export function useCreateAsset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createAsset,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['assets'] })
      qc.invalidateQueries({ queryKey: ['networth'] })
    },
  })
}

export function useUpdateAsset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }) => updateAsset(id, data),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['assets'] })
      qc.invalidateQueries({ queryKey: ['networth'] })
    },
  })
}

export function useDeleteAsset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteAsset,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['assets'] })
      qc.invalidateQueries({ queryKey: ['networth'] })
    },
  })
}