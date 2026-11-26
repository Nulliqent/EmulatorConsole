// Illustrative data for the prototype. Names and values are synthetic.
window.D = {
  calls: [
    { id: 'c1', t: '14:05:31', op: 'Invoke', svc: 'Lambda', sid: 'lambda', region: 'us-east-1', status: 404, err: 'ResourceNotFoundException', v: 'R', ms: 12,
      msg: 'Function not found: arn:aws:lambda:us-east-1:000000000000:function:resize-thumbnails',
      why: 'Lambda defines this error for Invoke, so it reads as a refused request. The Console can’t tell whether AWS would refuse it too.',
      acts: [['Open in operation form', '#/services/lambda/ops/Invoke'], ['Show Lambda functions', '#/services/lambda']],
      req: 'POST /2015-03-31/functions/resize-thumbnails/invocations\nhost: 127.0.0.1:9300\nx-amz-invocation-type: RequestResponse\nauthorization: (not stored)\n\n{\n  "bucket": "uploads",\n  "key": "cat.jpg"\n}',
      res: '404\nx-amzn-errortype: ResourceNotFoundException\ncontent-type: application/json\n\n{\n  "Message": "Function not found: arn:aws:lambda:us-east-1:000000000000:function:resize-thumbnails",\n  "Type": "User"\n}' },
    { id: 'c2', t: '14:05:30', op: 'DescribeDBProxyEndpoints', svc: 'RDS', sid: 'rds', region: 'us-east-1', status: 501, err: 'NotImplemented', v: 'G', ms: 3,
      msg: 'The response carried no message.',
      why: 'The Emulator answered 501: it hasn’t implemented this operation. Changing the request won’t help.',
      acts: [['Open the operation', '#/services/rds/ops']],
      req: 'POST /\nhost: 127.0.0.1:9300\ncontent-type: application/x-www-form-urlencoded\nauthorization: (not stored)\n\nAction=DescribeDBProxyEndpoints&Version=2014-10-31',
      res: '501\ncontent-type: text/xml\n\n<ErrorResponse>\n  <Error><Code>NotImplemented</Code></Error>\n</ErrorResponse>' },
    { id: 'c3', t: '14:05:28', op: 'PutRule', svc: 'EventBridge', sid: 'eventbridge', region: 'eu-west-1', status: 500, err: 'InternalFailure', v: 'U', ms: 41,
      msg: 'The response carried no message.',
      why: 'InternalFailure isn’t an error EventBridge defines for PutRule. It could come from the Emulator or from something in the request.',
      acts: [['Open in operation form', '#/services/eventbridge/ops'], ['Other PutRule Calls', '#/calls/c3']],
      req: 'POST /\nhost: 127.0.0.1:9300\nx-amz-target: AWSEvents.PutRule\nauthorization: (not stored)\n\n{\n  "Name": "order-placed",\n  "EventPattern": "{\\"source\\":[\\"shop.orders\\"]}"\n}',
      res: '500\nx-amzn-errortype: InternalFailure\n\n{ "__type": "InternalFailure" }' },
    { id: 'c4', t: '14:05:27', op: 'SendMessage', svc: 'SQS', sid: 'sqs', region: 'us-east-1', status: 200, v: 'OK', ms: 8,
      req: 'POST /\nhost: 127.0.0.1:9300\nx-amz-target: AmazonSQS.SendMessage\n\n{\n  "QueueUrl": "https://127.0.0.1:9300/000000000000/orders",\n  "MessageBody": "{\\"orderId\\":\\"o-1042\\"}"\n}',
      res: '200\n\n{ "MessageId": "5fea7756-0ea4-451a-a703-a558b933e274", "MD5OfMessageBody": "8f2b…" }' },
    { id: 'c5', t: '14:05:27', op: 'GetQueueUrl', svc: 'SQS', sid: 'sqs', region: 'us-east-1', status: 200, v: 'OK', ms: 4, req: 'POST /\nx-amz-target: AmazonSQS.GetQueueUrl\n\n{ "QueueName": "orders" }', res: '200\n\n{ "QueueUrl": "https://127.0.0.1:9300/000000000000/orders" }' },
    { id: 'c6', t: '14:05:26', op: 'PutItem', svc: 'DynamoDB', sid: 'dynamodb', region: 'us-east-1', status: 200, v: 'OK', ms: 6, req: 'POST /\nx-amz-target: DynamoDB_20120810.PutItem\n\n{ "TableName": "orders", "Item": { "orderId": { "S": "o-1042" } } }', res: '200\n\n{}' },
    { id: 'c7', t: '14:05:26', op: 'CreateTable', svc: 'DynamoDB', sid: 'dynamodb', region: 'us-east-1', status: 200, v: 'OK', ms: 22, req: 'POST /\nx-amz-target: DynamoDB_20120810.CreateTable\n\n{ "TableName": "orders", … }', res: '200\n\n{ "TableDescription": { "TableStatus": "CREATING" } }' },
    { id: 'c8', t: '14:05:25', op: 'PutObject', svc: 'S3', sid: 's3', region: 'us-east-1', status: 200, v: 'OK', ms: 15, req: 'PUT /uploads/cat.jpg\nhost: 127.0.0.1:9300\ncontent-length: 49152\n\nBinary body, 48 KB. Not shown.', res: '200\netag: "9b2cf535f27731c974343645a3985328"' },
    { id: 'c9', t: '14:05:24', op: 'CreateBucket', svc: 'S3', sid: 's3', region: 'us-east-1', status: 200, v: 'OK', ms: 9, req: 'PUT /uploads/\nhost: 127.0.0.1:9300', res: '200\nlocation: /uploads' },
    { id: 'c10', t: '14:05:24', op: 'GetCallerIdentity', svc: 'STS', sid: 'sts', region: 'us-east-1', status: 200, v: 'OK', ms: 2, req: 'POST /\n\nAction=GetCallerIdentity&Version=2011-06-15', res: '200\n\n<Account>000000000000</Account>' }
  ],
  services: [
    ['Access Analyzer', 'AccessAnalyzer', 'accessanalyzer'], ['Account', 'Account', 'account'], ['Amplify', 'Amplify', 'amplify'], ['API Gateway', 'API Gateway', 'apigateway'],
    ['AppConfig', 'AppConfig', 'appconfig'], ['AppSync', 'AppSync', 'appsync'], ['Athena', 'Athena', 'athena'], ['Backup', 'Backup', 'backup'], ['Batch', 'Batch', 'batch'],
    ['Bedrock', 'Bedrock', 'bedrock'], ['Braket', 'Braket', 'braket'], ['Budgets', 'Budgets', 'budgets'], ['CloudFormation', 'CloudFormation', 'cloudformation'],
    ['CloudWatch Logs', 'CloudWatch Logs', 'logs'], ['DynamoDB', 'DynamoDB', 'dynamodb'], ['EC2 Container Service', 'ECS', 'ecs'], ['Elastic Compute Cloud', 'EC2', 'ec2'],
    ['EventBridge', 'EventBridge', 'eventbridge'], ['Identity and Access Management', 'IAM', 'iam'], ['Key Management Service', 'KMS', 'kms'], ['Lambda', 'Lambda', 'lambda'],
    ['Relational Database Service', 'RDS', 'rds'], ['Simple Notification Service', 'SNS', 'sns'], ['Simple Queue Service', 'SQS', 'sqs'], ['Simple Storage Service', 'S3', 's3'],
    ['Step Functions', 'SFN', 'sfn'], ['Security Token Service', 'STS', 'sts']
  ],
  curated: ['s3', 'dynamodb', 'sqs', 'sns', 'lambda', 'logs', 'eventbridge', 'iam'],
  ops: {
    sfn: [['CreateStateMachine', 'Create'], ['DeleteStateMachine', 'Destructive'], ['DescribeExecution', 'Read'], ['DescribeStateMachine', 'Read'], ['ListActivities', 'List'], ['ListExecutions', 'List'], ['ListStateMachines', 'List'], ['StartExecution', 'Other'], ['StopExecution', 'Update'], ['TestState', 'Other'], ['UpdateStateMachine', 'Update']],
    rds: [['AddTagsToResource', 'Update'], ['CreateDBInstance', 'Create'], ['CreateDBProxyEndpoint', 'Create', 1], ['DeleteDBInstance', 'Destructive'], ['DescribeDBInstances', 'List'], ['DescribeDBProxyEndpoints', 'List', 1], ['ModifyDBInstance', 'Update']],
    budgets: [['CreateBudget', 'Create'], ['DeleteBudget', 'Destructive'], ['DescribeBudget', 'Read, needs AccountId and BudgetName'], ['DescribeBudgets', 'List, needs AccountId'], ['ExecuteBudgetAction', 'Other'], ['ListTagsForResource', 'List, needs ResourceARN'], ['UpdateBudget', 'Update']]
  },
  sm: [
    { name: 'order-flow', type: 'STANDARD', created: '2026-11-26 14:01:08', arn: 'arn:aws:states:us-east-1:000000000000:stateMachine:order-flow', role: 'arn:aws:iam::000000000000:role/flow' },
    { name: 'refund-flow', type: 'STANDARD', created: '2026-11-26 14:01:09', arn: 'arn:aws:states:us-east-1:000000000000:stateMachine:refund-flow', role: 'arn:aws:iam::000000000000:role/flow' },
    { name: 'thumbnail-batch', type: 'EXPRESS', created: '2026-11-26 14:01:09', arn: 'arn:aws:states:us-east-1:000000000000:stateMachine:thumbnail-batch', role: 'arn:aws:iam::000000000000:role/batch' }
  ],
  ec2lists: ['VPCs', 'Subnets', 'Security groups', 'Instances', 'Internet gateways', 'NAT gateways', 'Route tables', 'Key pairs', 'Volumes', 'VPC endpoints', 'VPC endpoint services', 'VPC peering connections', 'Network interfaces', 'Elastic IP addresses', 'Images', 'Launch templates']
};
