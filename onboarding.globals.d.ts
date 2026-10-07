declare namespace Classes {
	interface OnboardingController extends BaseController {
		outputEl: HTMLElement;
		emptyEl: HTMLParagraphElement;
		initPage(): Promise<void>;
	}
}
