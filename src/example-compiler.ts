import { pipe } from '@effect/data/Function';
import * as Option from '@effect/data/Option';
import * as Effect from '@effect/io/Effect';
import * as AST from '@effect/schema/AST';
import * as S from '@effect/schema/Schema';

const getExampleValue = (ast: AST.Annotated) =>
  pipe(
    AST.getAnnotation<AST.ExamplesAnnotation>(AST.ExamplesAnnotationId)(ast),
    Option.getOrUndefined
  );

const getIdentifier = (ast: AST.Annotated) =>
  pipe(
    AST.getAnnotation<AST.IdentifierAnnotation>(AST.IdentifierAnnotationId)(
      ast
    ),
    Option.getOrUndefined
  );

const randomChoice = <A>(
  xs: readonly A[]
): Effect.Effect<never, RandomExampleError, A> =>
  pipe(
    Effect.randomWith((r) => r.nextIntBetween(0, xs.length)),
    Effect.filterOrFail(
      (i) => i >= 0,
      () => randomExampleError(`Can choose from ${xs}`)
    ),
    Effect.map((i) => xs[i])
  );

export type RandomExampleError = {
  _tag: 'RandomExampleError';
  error: unknown;
};

export const randomExampleError = (error: unknown): RandomExampleError => ({
  _tag: 'RandomExampleError',
  error,
});

export const randomExample = <A>(
  schema: S.Schema<any, A>
): Effect.Effect<never, RandomExampleError, A> => {
  const go = (ast: AST.AST): Effect.Effect<never, RandomExampleError, any> => {
    const exampleFromAnnotation = getExampleValue(ast);

    if (exampleFromAnnotation) {
      return randomChoice(exampleFromAnnotation);
    }

    switch (ast._tag) {
      case 'Literal': {
        return Effect.succeed(ast.literal);
      }
      case 'UnknownKeyword':
        return Effect.succeed(undefined);
      case 'AnyKeyword':
        return randomChoice([{}, 'hello-world', 69, undefined]);
      case 'StringKeyword':
        return randomChoice(['hello world', 'patrik']);
      case 'NumberKeyword':
        return randomChoice([69, 420, 3.14]);
      case 'BooleanKeyword':
        return randomChoice([true, false]);
      case 'ObjectKeyword':
        return randomChoice([{ iam: 'object' }]);
      case 'Tuple': {
        const rest = pipe(
          Option.map(ast.rest, Effect.forEach(go)),
          Option.getOrElse(() => Effect.succeed([] as any[]))
        );

        const elements = pipe(
          ast.elements.values(),
          Effect.forEach((element) => go(element.type))
        );

        return Effect.flatMap(rest, (rest) =>
          Effect.map(elements, (elements) => [...elements, ...rest])
        );
      }
      case 'TypeLiteral': {
        if (
          ast.indexSignatures.length <
          ast.indexSignatures.filter(
            (is) => is.parameter._tag === 'StringKeyword'
          ).length
        ) {
          return Effect.fail(
            randomExampleError(
              `Cannot create example for some index signatures`
            )
          );
        }

        const result = pipe(
          ast.propertySignatures,
          Effect.reduce({}, (acc, ps) =>
            Effect.map(go(ps.type), (v) => ({ ...acc, [ps.name]: v }))
          )
        );

        return result;
      }
      case 'Union': {
        return Effect.flatten(randomChoice(ast.types.map(go)));
      }
      case 'Enums': {
        return randomChoice(ast.enums);
      }
      case 'Refinement': {
        const message = `Couldn't create an example for refinement AST, please specify example for ${JSON.stringify(
          ast
        )}`;
        return Effect.fail(randomExampleError(message));
      }
      case 'Transform':
        return go(ast.to);
      case 'UniqueSymbol':
        return Effect.fail(randomExampleError(`UniqueSymbol`));
      case 'UndefinedKeyword':
        return Effect.fail(randomExampleError(`UndefinedKeyword`));
      case 'VoidKeyword':
        return Effect.fail(randomExampleError(`VoidKeyword`));
      case 'NeverKeyword': {
        return Effect.fail(randomExampleError(`NeverKeyword`));
      }
      case 'BigIntKeyword': {
        return randomChoice([BigInt(69), BigInt(420), BigInt(3.14)]);
      }
      case 'SymbolKeyword':
        return Effect.fail(randomExampleError(`SymbolKeyword`));
      case 'Lazy':
        return go(ast.f());
      case 'TemplateLiteral': {
        const result = pipe(
          ast.spans,
          Effect.reduce(ast.head, (acc, v) =>
            Effect.map(go(v.type), (x) => `${acc}${x}${v.literal}`)
          )
        );

        return result;
      }
      case 'Declaration': {
        const identifier = getIdentifier(ast);

        if (identifier === 'Option') {
          return pipe(
            randomChoice([
              () => Effect.succeed(Option.none()),
              () => Effect.map(go(ast.typeParameters[0]), (v) => Option.some(v)),
            ]),
            Effect.flatMap((fn) => fn()),
          );
        }

        return Effect.fail(
          randomExampleError(
            `Can't give an example for declaration: ${JSON.stringify(ast)}`
          )
        );
      }
    }
  };

  return go(schema.ast);
};
