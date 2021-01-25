/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCClient, TRPCClientError } from '@trpc/client';
import type {
  DataTransformer,
  DropFirst,
  inferEndpointArgs,
  inferEndpointOutput,
  inferSubscriptionOutput,
  Router,
  RouterResolverFn,
} from '@trpc/server';
import { useCallback, useMemo } from 'react';
import {
  QueryClient,
  QueryObserverResult,
  useMutation,
  UseMutationOptions,
  useQuery,
  UseQueryOptions,
} from 'react-query';

export function createReactQueryHooks<
  TRouter extends Router<TContext, any, any, any>,
  TContext,
  TQueryClient extends QueryClient = any
>({
  client,
  queryClient,
  transformer = {
    serialize: (data) => data,
    deserialize: (data) => data,
  },
}: {
  client: TRPCClient;
  queryClient: TQueryClient;
  transformer?: DataTransformer;
}) {
  type TQueries = TRouter['_def']['queries'];
  type TMutations = TRouter['_def']['mutations'];
  type TSubscriptions = TRouter['_def']['subscriptions'];

  const serializeArgs = (args: unknown[]): unknown[] =>
    args.map((arg) => transformer.serialize(arg));

  function _useQuery<TPath extends keyof TQueries & string>(
    pathAndArgs: [TPath, ...inferEndpointArgs<TQueries[TPath]>],
    opts?: UseQueryOptions<
      inferEndpointArgs<TQueries[TPath]>,
      TRPCClientError,
      inferEndpointOutput<TQueries[TPath]>
    >,
  ) {
    type TOutput = inferEndpointOutput<TQueries[TPath]>;
    const [path, ...args] = pathAndArgs;

    const hook = useQuery<
      inferEndpointArgs<TQueries[TPath]>,
      TRPCClientError,
      TOutput
    >(
      pathAndArgs,
      () =>
        client.request({
          type: 'query',
          path,
          args: serializeArgs(args),
        }) as any,
      opts,
    );
    const data = useMemo(
      () =>
        typeof hook.data !== 'undefined'
          ? (transformer.deserialize(hook.data) as TOutput)
          : hook.data,
      [hook.data],
    );
    return {
      ...hook,
      data,
    } as QueryObserverResult<TOutput, TRPCClientError>;
  }

  // /**
  //  * use a query that doesn't require args
  //  * @deprecated **🚧 WIP** should be combined with `useQuery`
  //  */
  // function useQueryNoArgs<
  //   TPath extends inferEndpointsWithoutArgs<TQueries> & string & keyof TQueries
  // >(
  //   path: TPath,
  //   opts?: UseQueryOptions<
  //     never,
  //     TRPCClientError,
  //     inferEndpointOutput<TQueries[TPath]>
  //   >,
  // ) {
  //   const hook = useQuery<
  //     never,
  //     TRPCClientError,
  //     inferEndpointOutput<TQueries[TPath]>
  //   >(path, () => (client.query as any)(path) as any, opts);
  //   const data = useMemo(() => client.transformer.deserialize(hook.data), [
  //     hook.data,
  //   ]) as inferEndpointOutput<TQueries[TPath]>;

  //   return {
  //     ...hook,
  //     data,
  //   };
  // }
  function _useMutation<TPath extends keyof TMutations & string>(
    path: TPath,
    opts?: UseMutationOptions<
      inferEndpointOutput<TMutations[TPath]>,
      TRPCClientError,
      inferEndpointArgs<TMutations[TPath]>
    >,
  ) {
    const mutation = useMutation<
      inferEndpointOutput<TMutations[TPath]>,
      TRPCClientError,
      inferEndpointArgs<TMutations[TPath]>
    >(
      (args) =>
        client.request({
          type: 'mutation',
          path,
          args: serializeArgs(args),
        }) as any,
      opts,
    );

    const mutateAsync: typeof mutation['mutateAsync'] = useCallback(
      async (...args) => {
        const orig = await mutation.mutateAsync(...args);

        return transformer.deserialize(orig) as any;
      },
      [mutation.mutateAsync],
    );
    return {
      ...mutation,
      mutateAsync,
    };
  }

  function useSubscription<TPath extends keyof TSubscriptions & string>(
    pathAndArgs: [TPath, ...inferEndpointArgs<TSubscriptions[TPath]>],
    opts?: UseQueryOptions<
      inferEndpointArgs<TSubscriptions[TPath]>,
      TRPCClientError,
      inferSubscriptionOutput<TRouter, TPath>
    >,
  ) {
    type TOutput = inferSubscriptionOutput<TRouter, TPath>;

    const [path, ...args] = pathAndArgs;

    const hook = useQuery<
      inferEndpointArgs<TSubscriptions[TPath]>,
      TRPCClientError,
      TOutput
    >(
      pathAndArgs,
      () => client.subscriptionOnce(path, ...serializeArgs(args)) as any,
      opts,
    );

    const data = useMemo(
      () =>
        typeof hook.data !== 'undefined'
          ? (transformer.deserialize(hook.data) as TOutput)
          : hook.data,
      [hook.data],
    );
    return {
      ...hook,
      data,
    } as QueryObserverResult<TOutput, TRPCClientError>;
  }

  const ssr = async <
    TEndpoints extends TRouter['_def']['queries'],
    TResolver extends TEndpoints & RouterResolverFn,
    TArgs extends DropFirst<Parameters<TResolver>>,
    TPath extends keyof TEndpoints & string
  >(
    router: TRouter,
    path: TPath,
    ctx: TContext,
    ...args: TArgs
  ): Promise<void> => {
    // console.log('invoking', { ctx, path, router });
    return queryClient.prefetchQuery([path, ...args], async () => {
      const data = await router.invokeQuery(ctx)(
        path,
        ...(serializeArgs(args) as any),
      );
      // console.log('data', data);
      return transformer.serialize(data);
    });
  };

  return {
    useQuery: _useQuery,
    useMutation: _useMutation,
    useSubscription,
    queryClient,
    ssr,
  };
}