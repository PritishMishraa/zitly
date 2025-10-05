import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { collectDestinationInfo } from '@/helpers/browser-render';
import { aiDestinationChecker } from '@/helpers/ai-destination-checker';

export class DestinationEvaluationWorkflow extends WorkflowEntrypoint<Env, DestinationStatusEvaluationParams> {
	async run(event: Readonly<WorkflowEvent<DestinationStatusEvaluationParams>>, step: WorkflowStep) {
		const collectedData = await step.do('Collect rendered destination page data', async () => {
			return collectDestinationInfo(this.env, event.payload.destinationUrl);
		});

		const aiStatus = await step.do(
			'Use AI to check status of page',
			{
				retries: {
					limit: 0,
					delay: 0,
				},
			},
			async () => {
				return await aiDestinationChecker(this.env, collectedData.bodyText);
			},
		);

		console.log(aiStatus.status);
	}
}
