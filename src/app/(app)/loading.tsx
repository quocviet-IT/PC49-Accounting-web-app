import { PageSkeleton } from '@/components/ui/PageSkeleton'

/**
 * Shown the moment a signed-in screen is asked for, while the server builds it.
 *
 * Every screen here is dynamic, so without a loading boundary nothing of the
 * next screen can be prefetched and a click on the menu showed nothing until
 * the whole page had arrived.
 */
export default function Loading() {
  return <PageSkeleton />
}
