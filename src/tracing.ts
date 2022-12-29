import { traceFn } from './index';
import { OtlpJson } from './transformers/otlpjson';
import { Transformer } from './transformers/transformer';
import { generateSpanId, generateTraceId } from './utils/rand';

enum StatusCode {
	UNSET = 0,
	OK 		= 1,
	ERROR = 2,
}

export class Span {
	
	#span: SpanData;
	#childSpans: Span[];

	constructor(traceId: string, name: string, spanOptions?: SpanCreationOptions) {
		this.#span = {
			traceId: traceId,
			name,
			id: generateSpanId(),
			parentId: spanOptions?.parentId,
			timestamp: spanOptions?.timestamp ?? Date.now(),
			duration: spanOptions?.duration ?? 0,
			attributes: spanOptions?.attributes ?? {},
			status: spanOptions?.status ?? { code: StatusCode.UNSET },
			events: spanOptions?.events ?? [],
			links: spanOptions?.links ?? [],
		};
		this.#childSpans = [];
	}

	getSpanId() {
		return this.#span.id;
	}

	getData() {
		return this.#span;
	}

	getChildSpans() {
		return this.#childSpans;
	}

	getContext(): SpanContext {
		return { traceId: this.#span.traceId, spanId: this.#span.id };
	}

	startSpan(name: string, spanOptions?: SpanCreationOptions): Span {
		const span = new Span(this.#span.traceId, name, spanOptions);
		span.#span.parentId = this.getSpanId();

		console.log('Made new span -', span.getSpanId(), 'with parent ID:', this.getSpanId());

		// TODO: Figure out how to get this attached to Trace
		// Do I like this?
		this.#childSpans.push(span);

		return span;
	}

	trace<T>(name: string, fn: TracedFn<T>, opts?: SpanCreationOptions): T {
		return traceFn(this, name, fn, opts);
	}

	end() {
		this.#span.duration = Date.now() - this.#span.timestamp;
	}
}

export class Trace extends Span {

	#ctx: ExecutionContext;
	#tracerOptions: TracerOptions & { transformer?: Transformer };

	constructor(ctx: ExecutionContext, tracerOptions: TracerOptions & { transformer?: Transformer }) {
		super(
			tracerOptions.traceContext?.traceId ?? generateTraceId(),
			'Request (fetch event)',
			{
				parentId: tracerOptions.traceContext?.spanId,
			}
		);
		this.#ctx = ctx;
		this.#tracerOptions = tracerOptions;

		console.log('made new trace, root span:', this.getData());
	}

	/**
	 * @deprecated Use #getChildSpans
	 */
	getSpans() {
		return this.getChildSpans();
	}

	getTracerOptions() {
		return this.#tracerOptions;
	}

	async send() {
		// We need to end the trace here
		this.end();

		const headers = this.#tracerOptions.collector.headers || {};
		// @ts-ignore
		headers['Content-Type'] = 'application/json';
		// @ts-ignore		
		headers['x-trace-id'] = this.#traceId;

		let body;
		if (this.#tracerOptions.transformer) {
			body = this.#tracerOptions.transformer.transform(this);
		} else {
			body = new OtlpJson().transform(this);
		}

		const bodyStr = JSON.stringify(body);
		console.log('sending:');
		console.log(bodyStr);

		const res = await fetch(this.#tracerOptions.collector.url, {
			method: 'POST',
			headers,
			body: bodyStr,
		});
		console.log('trace sent -', res.status);

		const txt = await res.text();
		console.log(txt);

		// this.#ctx.waitUntil(fetch(this.#tracerOptions.collector.url, {
		// 	headers,
		// }));
	}
}
