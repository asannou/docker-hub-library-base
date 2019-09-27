variable "lambda_function_environment" {
  default = {}
}

variable "lambda_schedule_expression" {
  default = "rate(1 day)"
}

resource "aws_lambda_function" "lambda" {
  filename = "${data.archive_file.lambda.output_path}"
  function_name = "docker-hub-base-image-checker"
  role = "${aws_iam_role.lambda.arn}"
  handler = "index.handler"
  runtime = "nodejs10.x"
  timeout = "60"
  source_code_hash = "${data.archive_file.lambda.output_base64sha256}"
  environment {
    variables = "${var.lambda_function_environment}"
  }
}

data "archive_file" "lambda" {
  type = "zip"
  source_dir = "${path.module}/docker-hub-base-image-checker"
  output_path = "${path.module}/docker-hub-base-image-checker.zip"
}

resource "aws_iam_role" "lambda" {
  name = "LambdaRoleDockerHubBaseImageChecker"
  path = "/"
  assume_role_policy = "${data.aws_iam_policy_document.lambda-role.json}"
}

data "aws_iam_policy_document" "lambda-role" {
  statement {
    effect = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_cloudwatch_log_group" "lambda-log" {
  name = "/aws/lambda/${aws_lambda_function.lambda.function_name}"
  retention_in_days = 14
}

resource "aws_iam_role_policy_attachment" "lambda-log" {
  role = "${aws_iam_role.lambda.name}"
  policy_arn = "${aws_iam_policy.lambda-log.arn}"
}

resource "aws_iam_policy" "lambda-log" {
  name = "DockerHubBaseImageCheckerLogging"
  path = "/"
  policy = "${data.aws_iam_policy_document.lambda-log.json}"
}

data "aws_iam_policy_document" "lambda-log" {
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["arn:aws:logs:*:*:*"]
  }
}

resource "aws_lambda_permission" "cloudwatch" {
  action = "lambda:InvokeFunction"
  function_name = "${aws_lambda_function.lambda.function_name}"
  principal = "events.amazonaws.com"
  source_arn = "${aws_cloudwatch_event_rule.lambda.arn}"
}

resource "aws_cloudwatch_event_rule" "lambda" {
  name = "DockerHubBaseImageChecker"
  schedule_expression = "${var.lambda_schedule_expression}"
}

resource "aws_cloudwatch_event_target" "lambda" {
  rule = "${aws_cloudwatch_event_rule.lambda.name}"
  arn = "${aws_lambda_function.lambda.arn}"
}

