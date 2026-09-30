import type {TestType} from '@playwright/test';

/** Preserve the project's existing test/worker fixture types while observing its page fixture. */
export declare function createBrowserTest<T extends TestType<any, any>>(baseTest: T): T;
