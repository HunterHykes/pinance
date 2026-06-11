import { useQuery } from '@tanstack/react-query'
import { getNetWorth } from '../api'

export function useNetWorth(range = '1M') {
  return useQuery({
    queryKey: ['networth', range],
    queryFn:  () => getNetWorth({ range }).then(res => res.data),
    staleTime: 5 * 60 * 1000,
  })
}