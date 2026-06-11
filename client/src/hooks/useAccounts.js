import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAccounts, createAccount, updateAccount, deleteAccount } from '../api'

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn:  () => getAccounts().then(res => res.data),
  })
}

export function useCreateAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createAccount,
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['accounts'] }),
  })
}

export function useUpdateAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }) => updateAccount(id, data),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['accounts'] }),
  })
}

export function useDeleteAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }) => deleteAccount(id, data),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['accounts'] }),
  })
}